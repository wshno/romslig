import { useEffect, useMemo, useState } from 'react'
import {
  findFreeSpot,
  getCatalogItem,
  newId,
  polygonCentroid,
  type FurnitureItem,
  type RecognizeResult,
  type RecognizedItem,
  type PlanSide,
  type Room,
} from '@romslig/shared'
import { recognizeFurniture } from '@romslig/ai'
import { prepareImage } from '../api.ts'
import { withAi } from '../ai/client.ts'
import { DirectionPicker } from './DirectionPicker.tsx'
import { activeScenario, useStore } from '../store.ts'

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

export function RecognizePanel({ room, onClose }: { room: Room; onClose(): void }) {
  const project = useStore((s) => s.project)!
  const [files, setFiles] = useState<File[]>([])
  /** The plan wall each photo faces (same order as files). */
  const [facing, setFacing] = useState<(PlanSide | null)[]>([])
  const scenario = activeScenario(project)
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecognizeResult | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(() => new Set())
  const previews = useMemo(
    () => files.map((f) => ({ key: `${f.name}:${f.size}`, url: URL.createObjectURL(f) })),
    [files],
  )
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews])

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const images = await Promise.all(
        files.map(async (file, i) => ({ ...(await prepareImage(file)), facing: facing[i] ?? null })),
      )
      const r = await withAi((client) => recognizeFurniture(client, { project, roomId: room.id, hint, images }))
      if (!r) return // no key yet: the key dialog is open
      setResult(r)
      setChosen(new Set(r.items.map((_, i) => i).filter((i) => r.items[i]!.confidence !== 'low')))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const accept = () => {
    if (!result) return
    const items = placeRecognized(
      result.items.filter((_, i) => chosen.has(i)),
      room,
    )
    useStore.getState().addFurnitureItems(items)
    onClose()
  }

  return (
    <section className="recognize">
      <div className="row spread">
        <h4>Gjenkjenn møbler fra bilder</h4>
        <button className="link" onClick={onClose}>
          Lukk
        </button>
      </div>
      {!result && (
        <>
          <p className="muted">
            Last opp 1–4 bilder av «{room.name}». Ta dem gjerne fra hjørnene, så hele rommet er med. Møblene legges inn
            i varianten «{activeScenario(project).name}».
          </p>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const next = Array.from(e.target.files ?? []).slice(0, 4)
              setFiles(next)
              setFacing(next.map(() => null))
            }}
          />
          {files.length > 0 && (
            <>
              <p className="muted">
                For hvert bilde: klikk på veggen du så mot da du tok det. Da vet Claude hvilken vegg som er hvor.
              </p>
              <ul className="photo-list">
                {previews.map((p, i) => (
                  <li key={p.key}>
                    <img src={p.url} alt={`Bilde ${i + 1}`} />
                    <DirectionPicker
                      scenario={scenario}
                      room={room}
                      value={facing[i] ?? null}
                      onChange={(side) => setFacing(facing.map((v, j) => (j === i ? side : v)))}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
          <label className="field">
            <span>Tips til Claude</span>
            <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="f.eks. sengen er 180 cm bred" />
          </label>
          <button className="primary" disabled={!files.length || busy} onClick={() => void run()}>
            {busy ? 'Claude ser på bildene…' : '✨ Gjenkjenn møbler'}
          </button>
          {busy && <p className="muted">Dette tar gjerne et halvt til ett minutt.</p>}
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
                </li>
              ))}
            </ul>
          )}
          {result.notes && <p className="muted">{result.notes}</p>}
          <div className="row">
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
