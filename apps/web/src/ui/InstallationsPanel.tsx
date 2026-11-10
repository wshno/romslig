import {
  FIXTURE_INFO,
  FIXTURE_KINDS,
  PLACEMENT_LABELS,
  RUN_INFO,
  RUN_KINDS,
  RUN_PLACEMENTS,
  defaultRunHeight,
  polygonArea,
  roomAt,
  runLength,
  type Fixture,
  type FixtureKind,
  type LoweredCeiling,
  type Run,
  type RunKind,
  type RunPlacement,
} from '@romslig/shared'
import { activeScenario, useStore } from '../store.ts'
import { fmtM, fmtM2 } from '../theme.ts'
import { CmField } from './fields.tsx'

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

function TextFields({
  label,
  note,
  placeholder,
  onChange,
}: {
  label: string | null
  note?: string | null
  placeholder: string
  onChange(patch: { label?: string | null; note?: string | null }): void
}) {
  return (
    <>
      <label className="field">
        <span>Navn</span>
        <input
          value={label ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange({ label: e.target.value || null })}
        />
      </label>
      {note !== undefined && (
        <label className="field">
          <span>Notat</span>
          <input
            value={note ?? ''}
            placeholder="f.eks. «stoppekran under vasken»"
            onChange={(e) => onChange({ note: e.target.value || null })}
          />
        </label>
      )}
    </>
  )
}

export function FixtureProps({ fx }: { fx: Fixture }) {
  const scenario = useStore((s) => activeScenario(s.project!))
  const update = (p: Partial<Fixture>) => useStore.getState().updateFixture(fx.id, p)
  const info = FIXTURE_INFO[fx.kind]
  const room = roomAt(fx, scenario.rooms)
  return (
    <div className="props">
      <Header title={info.name} />
      <p className="muted">
        {room ? room.name : 'Utenfor rommene (f.eks. i trappeoppgangen)'}
        {fx.wallId ? ' · på vegg' : ''}
      </p>
      <label className="field">
        <span>Type</span>
        <select value={fx.kind} onChange={(e) => update({ kind: e.target.value as FixtureKind })}>
          {FIXTURE_KINDS.map((k) => (
            <option key={k} value={k}>
              {FIXTURE_INFO[k].name}
            </option>
          ))}
        </select>
      </label>
      <CmField label="Høyde over gulv" value={fx.z} onChange={(z) => update({ z: Math.max(0, z) })} />
      <TextFields label={fx.label} note={fx.note} placeholder={info.name} onChange={update} />
      <p className="muted">Dra symbolet for å flytte det. Nær en vegg festes det til veggflaten.</p>
    </div>
  )
}

export function RunProps({ run }: { run: Run }) {
  const ceilingHeight = useStore((s) => s.project!.ceilingHeight)
  const update = (p: Partial<Run>) => useStore.getState().updateRun(run.id, p)
  return (
    <div className="props">
      <Header title={RUN_INFO[run.kind].name} />
      <p className="muted">
        Lengde {fmtM(runLength(run))} · {run.points.length} punkter
      </p>
      <label className="field">
        <span>Type</span>
        <select
          value={run.kind}
          onChange={(e) => {
            const kind = e.target.value as RunKind
            update({ kind, diameter: RUN_INFO[kind].diameter })
          }}
        >
          {RUN_KINDS.map((k) => (
            <option key={k} value={k}>
              {RUN_INFO[k].name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Ligger</span>
        <select
          value={run.placement}
          onChange={(e) => {
            const placement = e.target.value as RunPlacement
            update({ placement, z: defaultRunHeight(placement, ceilingHeight) })
          }}
        >
          {RUN_PLACEMENTS.map((k) => (
            <option key={k} value={k}>
              {PLACEMENT_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <CmField label="Høyde over gulv" value={run.z} onChange={(z) => update({ z: Math.max(0, z) })} />
      <label className="field">
        <span>Diameter</span>
        <span className="num">
          <input
            type="number"
            step={1}
            min={1}
            value={Math.round(run.diameter * 1000)}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (v > 0) update({ diameter: v / 1000 })
            }}
          />
          <em>mm</em>
        </span>
      </label>
      <TextFields label={run.label} note={run.note} placeholder={RUN_INFO[run.kind].name} onChange={update} />
      <p className="muted">Dra de runde håndtakene for å flytte punktene.</p>
    </div>
  )
}

export function CeilingProps({ ceiling }: { ceiling: LoweredCeiling }) {
  const update = (p: Partial<LoweredCeiling>) => useStore.getState().updateLoweredCeiling(ceiling.id, p)
  return (
    <div className="props">
      <Header title="Nedforet tak" />
      <p className="muted">Areal {fmtM2(polygonArea(ceiling.polygon))}</p>
      <CmField label="Høyde under" value={ceiling.height} onChange={(h) => update({ height: Math.max(1.5, h) })} />
      <TextFields label={ceiling.label} placeholder="f.eks. Innkassing for ventilasjon" onChange={update} />
    </div>
  )
}

/** Summary in the overview: where the fuse box and main valve are, and counts per type. */
export function InstallationsOverview() {
  const scenario = useStore((s) => activeScenario(s.project!))
  const select = useStore((s) => s.select)
  const setTool = useStore((s) => s.setTool)
  const key = scenario.fixtures.filter((f) => ['fuse_box', 'main_valve', 'water_inlet'].includes(f.kind))
  const counts = new Map<string, number>()
  for (const f of scenario.fixtures) {
    if (key.includes(f)) continue
    counts.set(FIXTURE_INFO[f.kind].name, (counts.get(FIXTURE_INFO[f.kind].name) ?? 0) + 1)
  }
  const empty = !scenario.fixtures.length && !scenario.runs.length && !scenario.loweredCeilings.length
  const summary = [...counts].map(([name, n]) => `${n} × ${name.toLowerCase()}`)
  if (scenario.runs.length) summary.push(scenario.runs.length === 1 ? '1 føring' : `${scenario.runs.length} føringer`)
  if (scenario.loweredCeilings.length) summary.push(`${scenario.loweredCeilings.length} nedforet tak`)
  const missing = (['fuse_box', 'main_valve'] as const).filter((k) => !scenario.fixtures.some((f) => f.kind === k))
  return (
    <>
      {empty && (
        <p className="muted">
          Legg inn stikkontakter, sikringsskap, hovedkran, rør og kanaler med verktøyene <b>Punkt</b>, <b>Føring</b> og{' '}
          <b>Himling</b>. Da kan assistenten ta hensyn til dem.
        </p>
      )}
      <ul className="room-list">
        {key.map((f) => {
          const room = roomAt(f, scenario.rooms)
          return (
            <li key={f.id} onClick={() => select({ kind: 'fixture', id: f.id })}>
              <i style={{ background: FIXTURE_INFO[f.kind].category === 'water' ? '#2563eb' : '#ca8a04' }} />
              <span>{f.label ?? FIXTURE_INFO[f.kind].name}</span>
              <span className="muted">{room ? room.name : 'utenfor'}</span>
              <span />
            </li>
          )
        })}
      </ul>
      {summary.length > 0 && <p className="muted">{summary.join(', ')}</p>}
      {!empty && missing.length > 0 && (
        <p className="note">
          Ikke lagt inn: {missing.map((k) => FIXTURE_INFO[k].name.toLowerCase()).join(' og ')}.{' '}
          <button className="link" onClick={() => setTool('fixture')}>
            Legg til
          </button>
        </p>
      )}
    </>
  )
}
