import { useEffect, useMemo, useState } from 'react'
import {
  fileSlug,
  furnitureList,
  planDrawingSvg,
  polygonArea,
  setCustomCatalog,
  type FurnitureRow,
  type Project,
  type Scenario,
} from '@romslig/shared'
import { api } from '../api.ts'
import { saveFile, svgToPng, svgUrl } from '../download.ts'
import { useStore } from '../store.ts'
import { ROOM_LABELS, fmtM2 } from '../theme.ts'
import './print.css'

/** The choice in the variant list that shows every variant, one sheet each. */
const ALL = 'all'

const cm = (m: number) => Math.round(m * 100)

/**
 * A project on paper: for each variant the plan with dimensions, the rooms with their areas and
 * the furniture list. Printed, or saved as a PDF, with the browser's own print dialog.
 */
export function PrintPage({ projectId }: { projectId: string }) {
  // Coming from the editor, the project it holds is the newest there is: it has the changes that
  // are still on their way to the server. Opened directly, the page fetches the project itself.
  const [project, setProject] = useState<Project | null>(() => {
    const open = useStore.getState().project
    return open?.id === projectId ? open : null
  })
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState(true)
  const [furniture, setFurniture] = useState(true)

  useEffect(() => {
    if (project) return
    let left = false
    api
      .get(projectId)
      .then((p) => {
        if (left) return
        // The furniture types the project has made itself: the drawing looks them up by id
        setCustomCatalog(p.customFurniture)
        setProject(p)
      })
      .catch((e: unknown) => left || setError((e as Error).message))
    return () => {
      left = true
    }
  }, [project, projectId])

  // The browser suggests the page title as the name of a saved PDF
  const name = project?.name
  useEffect(() => {
    if (name === undefined) return
    const before = document.title
    document.title = `${name.trim() || 'Prosjekt'} – Romslig`
    return () => {
      document.title = before
    }
  }, [name])

  if (error)
    return (
      <div className="home">
        <p className="error">{error}</p>
        <a href="#/">← Tilbake</a>
      </div>
    )
  if (!project) return <div className="home muted">Laster prosjekt…</div>

  const which = chosen ?? project.activeScenarioId
  const sheets =
    which === ALL ? project.scenarios : [project.scenarios.find((s) => s.id === which) ?? project.scenarios[0]!]

  return (
    <div className="print-page">
      <nav className="print-tools" aria-label="Utskrift">
        <a href={`#/p/${project.id}`}>← Tilbake til prosjektet</a>
        <label>
          <span className="muted">Variant:</span>
          <select value={which} onChange={(e) => setChosen(e.target.value)}>
            {project.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {project.scenarios.length > 1 && <option value={ALL}>Alle varianter</option>}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={dimensions} onChange={(e) => setDimensions(e.target.checked)} />
          Mål
        </label>
        <label>
          <input type="checkbox" checked={furniture} onChange={(e) => setFurniture(e.target.checked)} />
          Møbler
        </label>
        <span className="spacer" />
        <button className="primary" onClick={() => window.print()}>
          Skriv ut eller lagre som PDF
        </button>
      </nav>
      {sheets.map((s) => (
        <Sheet key={s.id} project={project} scenario={s} dimensions={dimensions} furniture={furniture} />
      ))}
    </div>
  )
}

function Sheet(props: { project: Project; scenario: Scenario; dimensions: boolean; furniture: boolean }) {
  const { project, scenario, dimensions, furniture } = props
  const drawing = useMemo(() => planDrawingSvg(scenario, { dimensions, furniture }), [scenario, dimensions, furniture])
  const rows = useMemo(() => furnitureList(scenario), [scenario])
  const [pngError, setPngError] = useState<string | null>(null)
  const [today] = useState(() => new Date().toLocaleDateString('nb-NO'))

  const rooms = scenario.rooms.filter((r) => r.polygon.length >= 3)
  const total = rooms.reduce((sum, r) => sum + polygonArea(r.polygon), 0)
  const pieces = rows.reduce((sum, r) => sum + r.count, 0)
  const uncalibrated = project.planImage !== null && !project.calibration.calibrated

  const savePng = async () => {
    setPngError(null)
    try {
      const name = `romslig-${fileSlug(project.name, 'prosjekt')}-${fileSlug(scenario.name, 'variant')}.png`
      saveFile(name, await svgToPng(drawing.svg))
    } catch (e) {
      setPngError((e as Error).message)
    }
  }

  return (
    <section className="sheet">
      <header>
        <h1>{project.name}</h1>
        <p>
          {scenario.name} <span className="muted">· {today}</span>
        </p>
      </header>
      <img
        className="plan"
        src={svgUrl(drawing.svg)}
        width={Math.round(drawing.width * 100)}
        height={Math.round(drawing.height * 100)}
        alt={`Plantegning av ${scenario.name}`}
      />
      <p className="screen-only">
        <button onClick={() => void savePng()}>Last ned som PNG</button>
        {pngError && <span className="error"> {pngError}</span>}
      </p>
      {uncalibrated && (
        <p className="note">
          Målestokken er ikke kalibrert mot plantegningen. Målene her er derfor anslag til du har kalibrert.
        </p>
      )}
      <div className="lists">
        <div>
          <h2>Rom</h2>
          {rooms.length === 0 ? (
            <p className="muted">Ingen rom er tegnet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Rom</th>
                  <th>Type</th>
                  <th className="num">Areal</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{ROOM_LABELS[r.type]}</td>
                    <td className="num">{fmtM2(polygonArea(r.polygon))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>Sum</th>
                  <td className="num">{fmtM2(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
        <div>
          <h2>Møbler</h2>
          {rows.length === 0 ? (
            <p className="muted">Ingen møbler i denne varianten.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {furniture && <th className="num">Nr.</th>}
                  <th>Møbel</th>
                  <th className="num">Antall</th>
                  <th className="num">B × D × H (cm)</th>
                </tr>
              </thead>
              {byRoom(rows).map((group) => (
                <tbody key={group.roomId ?? ''}>
                  <tr className="group">
                    <th colSpan={furniture ? 4 : 3}>{group.room ?? 'Utenfor rommene'}</th>
                  </tr>
                  {group.rows.map((r) => (
                    <tr key={r.no}>
                      {furniture && <td className="num">{r.no}</td>}
                      <td>{r.name}</td>
                      <td className="num">{r.count}</td>
                      <td className="num">
                        {cm(r.w)} × {cm(r.d)} × {cm(r.h)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr>
                  <th colSpan={furniture ? 2 : 1}>I alt</th>
                  <td className="num">{pieces}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
      <p className="fine muted">
        Målene er hentet fra tegningen i Romslig og må kontrolleres på stedet før du bestiller eller bygger noe etter
        dem.
        {dimensions && ' Mål inne i rommene går fra vegg til vegg, de to utenfor planen fra ytterside til ytterside.'}
      </p>
    </section>
  )
}

/** The rows of the furniture list, which come sorted by room, as one group per room. */
function byRoom(rows: FurnitureRow[]) {
  const groups: { roomId: string | null; room: string | null; rows: FurnitureRow[] }[] = []
  for (const r of rows) {
    const last = groups.at(-1)
    if (last && last.roomId === r.roomId) last.rows.push(r)
    else groups.push({ roomId: r.roomId, room: r.room, rows: [r] })
  }
  return groups
}
