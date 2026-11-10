import { useMemo, useState } from 'react'
import { compareScenarios, type FurnitureCount, type Project, type Scenario } from '@romslig/shared'
import { Plan2D, type PlanView } from '../editor2d/Plan2D.tsx'
import { activeScenario, useStore } from '../store.ts'
import { fmtM2 } from '../theme.ts'

/** Sensible "before" for a variant: its parent, else the first other variant. */
function defaultBefore(p: Project, after: Scenario): string {
  if (after.parentId && p.scenarios.some((s) => s.id === after.parentId)) return after.parentId
  return (p.scenarios.find((s) => s.id !== after.id) ?? after).id
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1).replace('.', ',')} m²`

/** "1 vegg fjernet", "2 vegger fjernet": `{}` in the text is replaced by the number. */
const counted = (n: number, one: string, many: string) => (n === 1 ? one : many).replace('{}', String(n))

/** "Lenestol · 2 × Nattbord · Spisebord (fra Kjøkken)". Not commas: some names have one ("Sofa, 3-seter"). */
const item = (c: FurnitureCount) => (c.count > 1 ? c.count + ' × ' : '') + c.name + (c.from ? ` (fra ${c.from})` : '')
const items = (list: FurnitureCount[]) => list.map(item).join(' · ')

export function CompareView() {
  const project = useStore((s) => s.project)!
  const current = activeScenario(project)
  const [afterId, setAfterId] = useState(current.id)
  const [beforeId, setBeforeId] = useState(() => defaultBefore(project, current))
  const [view, setView] = useState<PlanView | null>(null)
  const before = project.scenarios.find((s) => s.id === beforeId) ?? current
  const after = project.scenarios.find((s) => s.id === afterId) ?? current
  const diff = useMemo(() => compareScenarios(before, after), [before, after])
  const shared = { value: view, set: setView }

  const picker = (value: string, onChange: (id: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {project.scenarios.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )

  // [how many, the text for one, the text for several, colour]
  const building: [number, string, string, string?][] = [
    [diff.walls.removed.length, '{} vegg fjernet', '{} vegger fjernet', 'rm'],
    [diff.walls.added.length, '{} ny vegg', '{} nye vegger', 'add'],
    [diff.walls.moved.length, '{} vegg flyttet', '{} vegger flyttet'],
    [diff.openings.added.length, '{} ny åpning', '{} nye åpninger', 'add'],
    [diff.openings.removed.length, '{} åpning fjernet', '{} åpninger fjernet', 'rm'],
    [diff.openings.resized.length, '{} åpning har ny bredde', '{} åpninger har ny bredde'],
    [diff.installations.added, '{} ny installasjon', '{} nye installasjoner', 'add'],
    [diff.installations.removed, '{} installasjon fjernet', '{} installasjoner fjernet', 'rm'],
    [diff.installations.moved, '{} installasjon endret', '{} installasjoner endret'],
  ]
  const changed = building.filter(([n]) => n > 0)

  return (
    <div className="compare">
      <div className="compare-head">
        <label>Før {picker(beforeId, setBeforeId)}</label>
        <button
          title="Bytt om"
          onClick={() => {
            setBeforeId(afterId)
            setAfterId(beforeId)
          }}
        >
          ⇄
        </button>
        <label>Etter {picker(afterId, setAfterId)}</label>
        <span className="spacer" />
        <button
          onClick={() => {
            useStore.getState().setActiveScenario(after.id)
            useStore.getState().setView('split')
          }}
        >
          Jobb videre i «{after.name}»
        </button>
      </div>
      <div className="compare-panes">
        <Plan2D
          key={`a-${before.id}`}
          scenarioId={before.id}
          readOnly
          sharedView={shared}
          title={`Før: ${before.name}`}
        />
        <Plan2D
          key={`b-${after.id}`}
          scenarioId={after.id}
          readOnly
          compareWith={before}
          sharedView={shared}
          title={`Etter: ${after.name}`}
        />
      </div>
      <div className="compare-summary">
        {before.id === after.id ? (
          <p className="muted">Velg to forskjellige varianter for å se forskjellene.</p>
        ) : (
          <>
            {diff.flags.length > 0 && (
              <ul className="warnings">
                {diff.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            <div className="compare-grid">
              <section>
                <h4>Vegger, åpninger og installasjoner</h4>
                {changed.length === 0 ? (
                  <p className="muted">Uendret.</p>
                ) : (
                  <ul>
                    {changed.map(([n, one, many, colour]) => (
                      <li key={one} className={colour}>
                        {counted(n, one, many)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h4>Rom</h4>
                {diff.rooms.length === 0 ? (
                  <p className="muted">Uendret.</p>
                ) : (
                  <ul>
                    {diff.rooms.map((r) => (
                      <li key={r.id}>
                        <b>{r.name}</b>: {r.before === null && <span className="add">nytt, {fmtM2(r.after!)}</span>}
                        {r.after === null && <span className="rm">slått sammen/borte ({fmtM2(r.before!)})</span>}
                        {r.before !== null && r.after !== null && (
                          <>
                            {fmtM2(r.before)} → {fmtM2(r.after)} ({signed(r.after - r.before)})
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="muted">
                  Sum: {fmtM2(diff.totalArea.before)} → {fmtM2(diff.totalArea.after)}
                </p>
              </section>
              <section>
                <h4>Møbler</h4>
                {diff.furniture.byRoom.length === 0 && <p className="muted">Uendret.</p>}
                {diff.furniture.byRoom.map((g) => (
                  <div key={g.roomId ?? 'outside'} className="compare-room">
                    <b>{g.room ?? 'Utenfor rom'}</b>
                    <ul>
                      {g.added.length > 0 && <li className="add">Lagt til: {items(g.added)}</li>}
                      {g.removed.length > 0 && <li className="rm">Fjernet: {items(g.removed)}</li>}
                      {g.moved.length > 0 && <li>Flyttet: {items(g.moved)}</li>}
                    </ul>
                  </div>
                ))}
                <p className={diff.problems.after > diff.problems.before ? 'error' : 'muted'}>
                  Møbler med problemer: {diff.problems.before} → {diff.problems.after}
                </p>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
