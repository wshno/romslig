import { useMemo, useState } from 'react'
import { compareScenarios, type Project, type Scenario } from '@romslig/shared'
import { Plan2D, type PlanView } from '../editor2d/Plan2D.tsx'
import { activeScenario, useStore } from '../store.ts'
import { fmtM2 } from '../theme.ts'

/** Sensible "before" for a variant: its parent, else the first other variant. */
function defaultBefore(p: Project, after: Scenario): string {
  if (after.parentId && p.scenarios.some((s) => s.id === after.parentId)) return after.parentId
  return (p.scenarios.find((s) => s.id !== after.id) ?? after).id
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1).replace('.', ',')} m²`

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

  const nothing =
    !diff.walls.removed.length &&
    !diff.walls.added.length &&
    !diff.walls.moved.length &&
    !diff.openings.added.length &&
    !diff.openings.removed.length &&
    !diff.openings.resized.length &&
    !diff.furniture.added.length &&
    !diff.furniture.removed.length &&
    !diff.furniture.moved.length

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
                <h4>Vegger og åpninger</h4>
                {nothing && <p className="muted">Ingen endringer i vegger eller møbler.</p>}
                <ul>
                  {diff.walls.removed.length > 0 && (
                    <li className="rm">{diff.walls.removed.length} vegg(er) fjernet</li>
                  )}
                  {diff.walls.added.length > 0 && <li className="add">{diff.walls.added.length} ny(e) vegg(er)</li>}
                  {diff.walls.moved.length > 0 && <li>{diff.walls.moved.length} vegg(er) flyttet</li>}
                  {diff.openings.added.length > 0 && (
                    <li className="add">{diff.openings.added.length} ny(e) åpning(er)</li>
                  )}
                  {diff.openings.removed.length > 0 && (
                    <li className="rm">{diff.openings.removed.length} åpning(er) fjernet</li>
                  )}
                  {diff.openings.resized.length > 0 && <li>{diff.openings.resized.length} åpning(er) endret bredde</li>}
                </ul>
              </section>
              <section>
                <h4>Rom</h4>
                {diff.rooms.length === 0 ? (
                  <p className="muted">Romarealene er uendret.</p>
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
                <ul>
                  {diff.furniture.added.length > 0 && (
                    <li className="add">Lagt til: {diff.furniture.added.join(', ')}</li>
                  )}
                  {diff.furniture.removed.length > 0 && (
                    <li className="rm">Fjernet: {diff.furniture.removed.join(', ')}</li>
                  )}
                  {diff.furniture.moved.length > 0 && <li>Flyttet: {diff.furniture.moved.join(', ')}</li>}
                </ul>
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
