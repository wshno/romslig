import { useEffect, useRef, useState } from 'react'
import {
  findFreeSpot,
  getCatalogItem,
  newId,
  polygonCentroid,
  type FurnitureItem,
  type RecognizeResult,
  type RecognizedItem,
  type CustomFurniture,
  catalogIssueUrl,
  proposalToCustomFurniture,
  type Room,
} from '@romslig/shared'
import { recognizeFurniture } from '@romslig/ai'
import { prepareImage } from '../api.ts'
import { withAi } from '../ai/client.ts'
import { DirectionPicker } from './DirectionPicker.tsx'
import { activeScenario, useStore } from '../store.ts'
import { clearSession, readSession, writeSession, type PreparedPhoto } from './recognizeSession.ts'

const CONFIDENCE = { high: 'sikker', medium: 'ganske sikker', low: 'usikker' } as const
const SIDES = {
  top: 'mot veggen øverst',
  right: 'mot veggen til høyre',
  bottom: 'mot veggen nederst',
  left: 'mot veggen til venstre',
  free: 'frittstående',
} as const
const cm = (m: number) => Math.round(m * 100)

/** Places recognised items in the room: each against its wall (or in the open floor), clear of conflicts where possible. */
function placeRecognized(items: RecognizedItem[], room: Room): FurnitureItem[] {
  let scenario = activeScenario(useStore.getState().project!)
  const placed: FurnitureItem[] = []
  // Big items first: they are the hardest to fit
  const ordered = [...items].sort((a, b) => b.size.w * b.size.d - a.size.w * a.size.d)
  for (const it of ordered) {
    const cat = getCatalogItem(it.catalogId)
    const differs = Math.abs(cat.w - it.size.w) + Math.abs(cat.d - it.size.d) + Math.abs(cat.h - it.size.h) > 0.03
    const size = differs ? it.size : null
    const spot = findFreeSpot(scenario, it.catalogId, room, {
      size,
      preferSide: it.side === 'free' ? undefined : it.side,
      freeStanding: it.side === 'free' ? true : undefined,
    }) ?? { ...polygonCentroid(room.polygon), rotation: 0 }
    const item: FurnitureItem = {
      id: newId('f_'),
      catalogId: it.catalogId,
      ...spot,
      roomId: room.id,
      size,
      label: it.name,
    }
    placed.push(item)
    scenario = { ...scenario, furniture: [...scenario.furniture, item] }
  }
  return placed
}

/** At most this many photos per recognition (the API takes 1–4). */
const MAX_PHOTOS = 4

/**
 * Asks the device to keep the screen on while Claude looks at the photos (30–60 s). Resolves to
 * null where the API is missing or refuses (no permission, battery saver), which costs nothing.
 */
async function keepScreenOn(): Promise<WakeLockSentinel | null> {
  try {
    return 'wakeLock' in navigator ? await navigator.wakeLock.request('screen') : null
  } catch {
    return null
  }
}

/** `onClose` says how the panel ended: closed by the user, or with the furniture placed. */
export function RecognizePanel({ room, onClose }: { room: Room; onClose(how: 'cancel' | 'placed'): void }) {
  const project = useStore((s) => s.project)!
  /** Downscaled photos with the plan wall each faces, restored if the tab was reloaded. */
  const [photos, setPhotos] = useState<PreparedPhoto[]>(() => {
    const saved = readSession(project.id)
    return saved?.roomId === room.id ? saved.photos.slice(0, MAX_PHOTOS) : []
  })
  /** Photos picked but still being downscaled. */
  const [preparing, setPreparing] = useState(0)
  const scenario = activeScenario(project)
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecognizeResult | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(() => new Set())
  /** Items to add as the project's own furniture type instead of the nearest catalog item. */
  const [asCustom, setAsCustom] = useState<Set<number>>(() => new Set())
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const newestRef = useRef<HTMLLIElement>(null)
  const shownRef = useRef(photos.length)

  // Keep the room and photos for this tab, so a reload while the camera is open brings them back
  useEffect(() => {
    writeSession({ projectId: project.id, roomId: room.id, photos })
  }, [project.id, room.id, photos])

  // Bring the newest photo and its direction picker into view after each one is added
  useEffect(() => {
    if (photos.length > shownRef.current) newestRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    shownRef.current = photos.length
  }, [photos.length])

  const full = photos.length + preparing >= MAX_PHOTOS

  /** Adds picked photos to the list (never replaces it), downscaled one at a time to spare memory. */
  const addPhotos = async (input: HTMLInputElement) => {
    const picked = Array.from(input.files ?? [])
    // Without this, picking the same file again fires no change event
    input.value = ''
    const take = picked.slice(0, Math.max(0, MAX_PHOTOS - photos.length - preparing))
    if (!take.length) return
    setError(picked.length > take.length ? `Bare ${MAX_PHOTOS} bilder kan brukes. De siste ble ikke lagt til.` : null)
    setPreparing((n) => n + take.length)
    for (const file of take) {
      try {
        const image = await prepareImage(file)
        setPhotos((list) =>
          list.length >= MAX_PHOTOS ? list : [...list, { id: newId('ph_'), ...image, facing: null }],
        )
      } catch {
        setError('Klarte ikke å lese bildet. Prøv et annet (JPEG eller PNG).')
      } finally {
        setPreparing((n) => n - 1)
      }
    }
  }

  const close = (how: 'cancel' | 'placed') => {
    clearSession()
    onClose(how)
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    const wakeLock = await keepScreenOn()
    try {
      const images = photos.map((p) => ({ mediaType: p.mediaType, data: p.data, facing: p.facing }))
      const r = await withAi((client) => recognizeFurniture(client, { project, roomId: room.id, hint, images }))
      if (!r) return // no key yet: the key dialog is open
      setResult(r)
      setChosen(new Set(r.items.map((_, i) => i).filter((i) => r.items[i]!.confidence !== 'low')))
      setAsCustom(new Set(r.items.map((_, i) => i).filter((i) => r.items[i]!.proposal)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      wakeLock?.release().catch(() => {})
    }
  }

  const accept = () => {
    if (!result) return
    // Furniture the catalog has nothing similar for becomes the project's own type, with the size
    // seen in the photos; it is registered before placing so the checks know its size.
    const custom: CustomFurniture[] = []
    const selected = result.items.flatMap((it, i) => {
      if (!chosen.has(i)) return []
      if (!asCustom.has(i) || !it.proposal) return [it]
      const own = { ...proposalToCustomFurniture(it.proposal), ...it.size }
      custom.push(own)
      return [{ ...it, catalogId: own.id }]
    })
    const store = useStore.getState()
    if (custom.length) store.addCustomFurniture(custom)
    const placed = placeRecognized(selected, room)
    store.addFurnitureItems(placed)
    // Show the new furniture in the plan, selected, so it can be moved into place straight away
    if (store.view === '3d' || store.view === 'compare') store.setView('2d')
    placed.forEach((f, i) => {
      if (i === 0) store.select({ kind: 'furniture', id: f.id })
      else store.pick({ kind: 'furniture', id: f.id }, true)
    })
    // Last, so whatever follows the selection (the phone's sheet) hears that the panel is done after it
    close('placed')
  }

  return (
    <section className="recognize">
      <div className="row spread">
        <h4>Gjenkjenn møbler fra bilder</h4>
        <button className="link" onClick={() => close('cancel')}>
          Lukk
        </button>
      </div>
      {!result && (
        <>
          <p className="muted">
            Bruk 1–4 bilder av «{room.name}». Ta dem gjerne fra hjørnene, så hele rommet er med. Møblene legges inn i
            varianten «{activeScenario(project).name}».
          </p>
          {photos.length > 0 && (
            <>
              <p className="muted">
                For hvert bilde: velg veggen du så mot da du tok det. Da vet Claude hvilken vegg som er hvor.
              </p>
              <ul className="photo-list">
                {photos.map((p, i) => {
                  const last = i === photos.length - 1
                  return (
                    <li key={p.id} ref={last ? newestRef : undefined} className={last ? 'newest' : undefined}>
                      <div className="photo-thumb">
                        <img src={`data:${p.mediaType};base64,${p.data}`} alt={`Bilde ${i + 1}`} />
                        <button
                          type="button"
                          className="link danger"
                          aria-label={`Fjern bilde ${i + 1}`}
                          disabled={busy}
                          onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}
                        >
                          Fjern
                        </button>
                      </div>
                      <DirectionPicker
                        scenario={scenario}
                        room={room}
                        value={p.facing}
                        onChange={(side) => setPhotos(photos.map((x) => (x.id === p.id ? { ...x, facing: side } : x)))}
                      />
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {preparing > 0 && <p className="muted">Gjør klar bildet…</p>}
          {photos.length >= MAX_PHOTOS && <p className="muted">Fire bilder er nok. Fjern ett for å bytte det ut.</p>}
          <label className="field">
            <span>Tips til Claude</span>
            <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="f.eks. sengen er 180 cm bred" />
          </label>
          <div className="recognize-actions">
            <div className="row">
              {/* The camera button shows on touch devices only; a desktop gets the file picker alone */}
              <button
                type="button"
                className="coarse-only"
                disabled={full || busy}
                onClick={() => cameraRef.current?.click()}
              >
                📷 Ta bilde
              </button>
              <button type="button" disabled={full || busy} onClick={() => galleryRef.current?.click()}>
                Velg <span className="coarse-only">fra</span> bilder
              </button>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                data-testid="photo-camera"
                onChange={(e) => void addPhotos(e.currentTarget)}
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                data-testid="photo-files"
                onChange={(e) => void addPhotos(e.currentTarget)}
              />
            </div>
            <button className="primary" disabled={!photos.length || preparing > 0 || busy} onClick={() => void run()}>
              {busy ? 'Claude ser på bildene…' : '✨ Gjenkjenn møbler'}
            </button>
          </div>
          {busy && (
            <p className="muted" role="status">
              Dette tar gjerne et halvt til ett minutt. La siden stå åpen så lenge.
            </p>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          {result.items.length === 0 ? (
            <p className="muted">Fant ingen møbler.</p>
          ) : (
            <ul className="recognized">
              {result.items.map((it, i) => (
                <li key={`${it.catalogId}:${it.name}:${it.photo}:${cm(it.size.w)}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen.has(i)}
                      onChange={(e) => {
                        const next = new Set(chosen)
                        if (e.target.checked) next.add(i)
                        else next.delete(i)
                        setChosen(next)
                      }}
                    />
                    <span>
                      <b>{it.name}</b>
                      <br />
                      <span className="muted">
                        {getCatalogItem(it.catalogId).name} · {cm(it.size.w)}×{cm(it.size.d)}×{cm(it.size.h)} cm ·{' '}
                        {SIDES[it.side]} · bilde {it.photo}
                      </span>
                      <br />
                      <span className="muted">{it.positionHint}</span>{' '}
                      <span className={`confidence ${it.confidence}`}>{CONFIDENCE[it.confidence]}</span>
                    </span>
                  </label>
                  {it.proposal && (
                    <ProposalRow
                      item={it}
                      useCustom={asCustom.has(i)}
                      onToggle={(on) => {
                        const next = new Set(asCustom)
                        if (on) next.add(i)
                        else next.delete(i)
                        setAsCustom(next)
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {result.notes && <p className="muted">{result.notes}</p>}
          <div className="row recognize-actions">
            <button className="primary" disabled={!chosen.size} onClick={accept}>
              Legg inn {chosen.size} møbler
            </button>
            <button onClick={() => setResult(null)}>Prøv igjen</button>
          </div>
          <p className="muted">Møblene plasseres mot riktig vegg der det er plass. Juster dem etterpå ved å dra.</p>
        </>
      )}
    </section>
  )
}

/** For furniture the catalog has no good match for: use it as your own type, or propose it. */
function ProposalRow({
  item,
  useCustom,
  onToggle,
}: {
  item: RecognizedItem
  useCustom: boolean
  onToggle(on: boolean): void
}) {
  const p = item.proposal!
  const issue = catalogIssueUrl(
    { ...proposalToCustomFurniture(p), ...item.size },
    { nameEn: p.nameEn, needsNewShape: p.needsNewShape },
  )
  return (
    <div className="proposal">
      <span className={`match ${item.match}`}>
        {item.match === 'none' ? 'Ikke i katalogen' : `Ligner på «${getCatalogItem(item.catalogId).name}»`}
      </span>
      <label>
        <input type="checkbox" checked={useCustom} onChange={(e) => onToggle(e.target.checked)} />
        <span>Legg inn som eget møbel «{p.name}»</span>
      </label>
      <a
        href={issue}
        target="_blank"
        rel="noopener noreferrer"
        title="Åpner et ferdig utfylt GitHub-issue (uten bilder)"
      >
        Foreslå for katalogen ↗
      </a>
    </div>
  )
}
