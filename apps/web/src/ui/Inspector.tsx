import { useState } from 'react'
import {
  ROOM_TYPES,
  areaDeviation,
  polygonArea,
  wallLength,
  type LoadBearing,
  type Opening,
  type OpeningKind,
  type Room,
  type RoomType,
  type Wall,
} from '@romslig/shared'
import { api } from '../api.ts'
import { activeScenario, useStore } from '../store.ts'
import { ROOM_COLORS, ROOM_LABELS, fmtM, fmtM2 } from '../theme.ts'

export function Inspector() {
  const project = useStore((s) => s.project)!
  const selection = useStore((s) => s.selection)
  const scenario = activeScenario(project)
  const wall = selection?.kind === 'wall' ? scenario.walls.find((w) => w.id === selection.id) : undefined
  const opening = selection?.kind === 'opening' ? scenario.openings.find((o) => o.id === selection.id) : undefined
  const room = selection?.kind === 'room' ? scenario.rooms.find((r) => r.id === selection.id) : undefined
  let content = <Overview />
  if (wall) content = <WallProps wall={wall} />
  else if (opening) content = <OpeningProps o={opening} />
  else if (room) content = <RoomProps room={room} />
  return <aside className="inspector">{content}</aside>
}

function Num({
  label,
  value,
  onChange,
  step = 0.01,
  unit = 'm',
  min,
}: {
  label: string
  value: number
  onChange(v: number): void
  step?: number
  unit?: string
  min?: number
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="num">
        <input
          type="number"
          step={step}
          min={min}
          value={Math.round(value * 1000) / 1000}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!Number.isNaN(v)) onChange(v)
          }}
        />
        <em>{unit}</em>
      </span>
    </label>
  )
}

function Header({ title }: { title: string }) {
  const { select, deleteSelected } = useStore.getState()
  return (
    <div className="inspector-header">
      <button className="link" onClick={() => select(null)}>
        ← Oversikt
      </button>
      <h3>{title}</h3>
      <button className="link danger" onClick={deleteSelected} title="Slett (Delete)">
        Slett
      </button>
    </div>
  )
}

function WallProps({ wall }: { wall: Wall }) {
  const update = (p: Partial<Wall>) => useStore.getState().updateWall(wall.id, p)
  const n = useStore((s) => activeScenario(s.project!).openings.filter((o) => o.wallId === wall.id).length)
  return (
    <div className="props">
      <Header title="Vegg" />
      <p className="muted">
        Lengde {fmtM(wallLength(wall))} · {n} åpning(er)
      </p>
      <Num label="Tykkelse" value={wall.thickness} onChange={(v) => update({ thickness: Math.max(0.03, v) })} />
      <Num label="Høyde" value={wall.height} onChange={(v) => update({ height: Math.max(0.5, v) })} />
      <label className="field">
        <span>Bærende</span>
        <select value={wall.loadBearing} onChange={(e) => update({ loadBearing: e.target.value as LoadBearing })}>
          <option value="unknown">Ukjent</option>
          <option value="yes">Ja</option>
          <option value="no">Nei</option>
        </select>
      </label>
      <label className="field check">
        <input type="checkbox" checked={wall.exterior} onChange={(e) => update({ exterior: e.target.checked })} />
        <span>Yttervegg</span>
      </label>
      {wall.loadBearing !== 'no' && (
        <p className="note">
          Før du river eller flytter denne veggen bør en rådgivende ingeniør (RIB) vurdere om den er bærende.
        </p>
      )}
    </div>
  )
}

const KIND_LABEL: Record<OpeningKind, string> = { door: 'Dør', window: 'Vindu', opening: 'Åpning' }

function OpeningProps({ o }: { o: Opening }) {
  const update = (p: Partial<Opening>) => useStore.getState().updateOpening(o.id, p)
  return (
    <div className="props">
      <Header title={KIND_LABEL[o.kind]} />
      <label className="field">
        <span>Type</span>
        <select value={o.kind} onChange={(e) => update({ kind: e.target.value as OpeningKind })}>
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <Num label="Bredde" value={o.width} onChange={(v) => update({ width: Math.max(0.2, v) })} />
      <Num label="Høyde" value={o.height} onChange={(v) => update({ height: Math.max(0.2, v) })} />
      <Num label="Brystning" value={o.sill} onChange={(v) => update({ sill: Math.max(0, v) })} />
      <Num label="Posisjon (senter)" value={o.offset} onChange={(v) => update({ offset: v })} />
      <p className="muted">Tips: dra åpningen langs veggen i 2D.</p>
    </div>
  )
}

function RoomProps({ room }: { room: Room }) {
  const update = (p: Partial<Room>) => useStore.getState().updateRoom(room.id, p)
  const area = polygonArea(room.polygon)
  const dev = areaDeviation(room)
  return (
    <div className="props">
      <Header title="Rom" />
      <label className="field">
        <span>Navn</span>
        <input value={room.name} onChange={(e) => update({ name: e.target.value })} />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={room.type} onChange={(e) => update({ type: e.target.value as RoomType })}>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ROOM_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <p>
        Målt areal: <b>{fmtM2(area)}</b>
      </p>
      <label className="field">
        <span>Oppgitt areal</span>
        <span className="num">
          <input
            type="number"
            step={0.1}
            value={room.statedArea ?? ''}
            placeholder="fra tegningen"
            onChange={(e) => update({ statedArea: e.target.value ? parseFloat(e.target.value) : null })}
          />
          <em>m²</em>
        </span>
      </label>
      {dev !== null && (
        <p className={Math.abs(dev) > 0.05 ? 'error' : 'ok'}>
          Avvik {dev > 0 ? '+' : ''}
          {(dev * 100).toFixed(1)} %{Math.abs(dev) > 0.05 ? '. Sjekk kalibrering og veggplassering.' : '. OK'}
        </p>
      )}
    </div>
  )
}

function Overview() {
  const project = useStore((s) => s.project)!
  const scenario = activeScenario(project)
  const { updateProject, detectRooms, select, setTool } = useStore.getState()
  const total = scenario.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="props">
      <h3>Oversikt</h3>
      <section>
        <h4>1. Målestokk</h4>
        {project.calibration.calibrated ? (
          <p className="ok">Kalibrert ({project.calibration.pxPerMeter.toFixed(1)} px/m)</p>
        ) : (
          <p className="note">
            Ikke kalibrert. Bruk <b>Kalibrer</b> og klikk på endene av en målsatt vegg, eller la AI-en finne
            målestokken.
          </p>
        )}
        <button onClick={() => setTool('calibrate')}>📏 Kalibrer</button>
      </section>

      <section>
        <h4>2. Digitaliser</h4>
        <DigitizePanel />
        <p className="muted">
          Eller tegn veggene selv med <b>Vegg</b>-verktøyet (W).
        </p>
      </section>

      <section>
        <h4>3. Rom</h4>
        <button
          onClick={() => {
            const n = detectRooms()
            setMsg(n ? `Fant ${n} rom.` : 'Fant ingen lukkede rom. Sjekk at veggene henger sammen i hjørnene.')
          }}
        >
          Finn rom automatisk
        </button>
        {msg && <p className="muted">{msg}</p>}
        <ul className="room-list">
          {scenario.rooms.map((r) => {
            const dev = areaDeviation(r)
            return (
              <li key={r.id} onClick={() => select({ kind: 'room', id: r.id })}>
                <i style={{ background: ROOM_COLORS[r.type] }} />
                <span>{r.name}</span>
                <span className="muted">{fmtM2(polygonArea(r.polygon))}</span>
                {dev !== null && (
                  <span className={Math.abs(dev) > 0.05 ? 'error' : 'ok'}>
                    {dev > 0 ? '+' : ''}
                    {(dev * 100).toFixed(0)}%
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        {scenario.rooms.length > 0 && (
          <p>
            Sum: <b>{fmtM2(total)}</b>
          </p>
        )}
      </section>

      <section>
        <h4>Innstillinger</h4>
        <Num
          label="Takhøyde"
          value={project.ceilingHeight}
          onChange={(v) => updateProject((p) => ({ ...p, ceilingHeight: Math.max(1.8, v) }))}
        />
        <button
          className="link"
          onClick={() =>
            updateProject((p) => ({
              ...p,
              scenarios: p.scenarios.map((s) =>
                s.id === p.activeScenarioId
                  ? { ...s, walls: s.walls.map((w) => ({ ...w, height: p.ceilingHeight })) }
                  : s,
              ),
            }))
          }
        >
          Bruk takhøyden på alle vegger
        </button>
        <Num
          label="Nord (grader)"
          step={1}
          unit="°"
          value={project.northAngle}
          onChange={(v) => updateProject((p) => ({ ...p, northAngle: v }))}
        />
      </section>
    </div>
  )
}

function DigitizePanel() {
  const project = useStore((s) => s.project)!
  const suggestion = useStore((s) => s.suggestion)
  const { setSuggestion, acceptSuggestion } = useStore.getState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasGeometry = activeScenario(project).walls.length > 0

  if (!project.planImage) return <p className="muted">Prosjektet har ingen plantegning.</p>

  if (suggestion) {
    const src = {
      calibration: 'din kalibrering',
      dimensions: 'målelinjer på tegningen',
      areas: 'oppgitte romarealer',
      none: 'ingen (ukalibrert)',
    }[suggestion.scaleSource]
    return (
      <div className="suggestion">
        <p>
          <b>AI-forslag:</b> {suggestion.walls.length} vegger, {suggestion.openings.length} åpninger,{' '}
          {suggestion.rooms.length} rom.
          <br />
          <span className="muted">Målestokk fra {src}.</span>
        </p>
        {suggestion.notes && <p className="muted">{suggestion.notes}</p>}
        {suggestion.warnings.length > 0 && (
          <ul className="warnings">
            {suggestion.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {hasGeometry && (
          <p className="note">Hvis du godtar, erstattes veggene i varianten «{activeScenario(project).name}».</p>
        )}
        <div className="row">
          <button className="primary" onClick={acceptSuggestion}>
            Godta
          </button>
          <button onClick={() => setSuggestion(null)}>Forkast</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            setSuggestion(await api.digitize(project.id))
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Claude analyserer tegningen…' : '✨ Digitaliser med AI'}
      </button>
      {busy && <p className="muted">Dette kan ta 1–3 minutter.</p>}
      {error && <p className="error">{error}</p>}
    </>
  )
}
