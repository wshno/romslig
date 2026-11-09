import { useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { Plan2D } from '../editor2d/Plan2D.tsx'
import { Viewer3D } from '../viewer3d/Viewer3D.tsx'
import { activeScenario, redo, undo, useStore, type Tool, type ViewMode } from '../store.ts'
import { Inspector } from './Inspector.tsx'

const TOOLS: { id: Tool; label: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Velg', icon: '↖', key: 'v' },
  { id: 'wall', label: 'Vegg', icon: '▭', key: 'w' },
  { id: 'door', label: 'Dør', icon: '🚪', key: 'd' },
  { id: 'window', label: 'Vindu', icon: '▤', key: 'n' },
  { id: 'opening', label: 'Åpning', icon: '⬚', key: 'o' },
  { id: 'room', label: 'Rom', icon: '⬠', key: 'r' },
  { id: 'calibrate', label: 'Kalibrer', icon: '📏', key: 'k' },
]

type SaveState = 'saved' | 'saving' | 'error'
const SAVE_LABELS: Record<SaveState, string> = { saved: 'Lagret', saving: 'Lagrer…', error: 'Feil ved lagring' }

export function Editor({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.project)
  const [error, setError] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>('saved')

  // Load
  useEffect(() => {
    useStore.setState({ project: null })
    api
      .get(projectId)
      .then((p) => {
        useStore.getState().load(p)
        useStore.temporal.getState().clear()
      })
      .catch((e) => setError(e.message))
  }, [projectId])

  // Debounced autosave
  const loadedRef = useRef<unknown>(null)
  useEffect(() => {
    if (!project) return
    if (loadedRef.current === null) {
      loadedRef.current = project
      return
    }
    setSave('saving')
    const t = setTimeout(() => {
      api
        .save(project)
        .then(() => setSave('saved'))
        .catch((e) => {
          setSave('error')
          setError(e.message)
        })
    }, 600)
    return () => clearTimeout(t)
  }, [project])

  // Keyboard shortcuts
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing =
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        (target instanceof HTMLInputElement && !['range', 'checkbox', 'button'].includes(target.type))
      if (typing) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        useStore.getState().deleteSelected()
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase())
        if (t && document.pointerLockElement === null) useStore.getState().setTool(t.id)
        if (e.key === 'Escape') useStore.getState().setTool('select')
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  if (error && !project)
    return (
      <div className="home">
        <p className="error">{error}</p>
        <a href="#/">← Tilbake</a>
      </div>
    )
  if (!project) return <div className="home muted">Laster prosjekt…</div>

  return (
    <div className="editor">
      <TopBar save={save} />
      <Toolbar />
      <main className="views">
        <ViewPanes />
      </main>
      <Inspector />
      {error && (
        <div className="toast error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  )
}

function ViewPanes() {
  const view = useStore((s) => s.view)
  return (
    <div className={`views-inner ${view}`}>
      {view !== '3d' && <Plan2D />}
      {view !== '2d' && <Viewer3D />}
    </div>
  )
}

function TopBar({ save }: { save: SaveState }) {
  const project = useStore((s) => s.project)!
  const view = useStore((s) => s.view)
  const { setView, updateProject, setActiveScenario, duplicateScenario, renameScenario, deleteScenario } =
    useStore.getState()
  const scenario = activeScenario(project)
  const views: { id: ViewMode; label: string }[] = [
    { id: '2d', label: '2D' },
    { id: 'split', label: '2D + 3D' },
    { id: '3d', label: '3D' },
  ]
  return (
    <header className="topbar">
      <a href="#/" className="back" title="Alle prosjekter">
        ←
      </a>
      <input
        className="project-name"
        value={project.name}
        onChange={(e) => updateProject((p) => ({ ...p, name: e.target.value }))}
      />
      <div className="scenario">
        <span className="muted">Variant:</span>
        <select value={scenario.id} onChange={(e) => setActiveScenario(e.target.value)}>
          {project.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          title="Ny variant (kopi av denne)"
          onClick={() => {
            const name = prompt('Navn på ny variant', `${scenario.name} (kopi)`)
            if (name) duplicateScenario(name)
          }}
        >
          ＋
        </button>
        <button
          title="Gi nytt navn"
          onClick={() => {
            const name = prompt('Nytt navn', scenario.name)
            if (name) renameScenario(scenario.id, name)
          }}
        >
          ✎
        </button>
        <button
          title="Slett variant"
          disabled={project.scenarios.length <= 1}
          onClick={() => confirm(`Slette varianten «${scenario.name}»?`) && deleteScenario(scenario.id)}
        >
          🗑
        </button>
      </div>
      <div className="spacer" />
      <button title="Angre (Ctrl+Z)" onClick={undo}>
        ↶
      </button>
      <button title="Gjør om (Ctrl+Y)" onClick={redo}>
        ↷
      </button>
      <div className="segmented">
        {views.map((v) => (
          <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      <span className={`save-state ${save}`}>{SAVE_LABELS[save]}</span>
    </header>
  )
}

function Toolbar() {
  const tool = useStore((s) => s.tool)
  const thickness = useStore((s) => s.wallThickness)
  const { setTool, setWallThickness } = useStore.getState()
  return (
    <nav className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={tool === t.id ? 'active' : ''}
          onClick={() => setTool(t.id)}
          title={`${t.label} (${t.key.toUpperCase()})`}
        >
          <span className="icon">{t.icon}</span>
          <span className="label">{t.label}</span>
        </button>
      ))}
      {tool === 'wall' && (
        <label className="thickness" title="Veggtykkelse for nye vegger">
          Tykkelse
          <select value={thickness} onChange={(e) => setWallThickness(+e.target.value)}>
            <option value={0.07}>7 cm</option>
            <option value={0.1}>10 cm</option>
            <option value={0.15}>15 cm</option>
            <option value={0.2}>20 cm</option>
            <option value={0.25}>25 cm</option>
            <option value={0.3}>30 cm</option>
          </select>
        </label>
      )}
    </nav>
  )
}
