import { useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { Plan2D } from '../editor2d/Plan2D.tsx'
import { Viewer3D } from '../viewer3d/Viewer3D.tsx'
import { activeScenario, redo, resetHistory, undo, useStore, type Tool, type ViewMode } from '../store.ts'
import { useHistory, useTypingAsOneUndoStep } from '../hooks.ts'
import { Inspector } from './Inspector.tsx'
import { CompareView } from './CompareView.tsx'
import { ApiKeyButton, ApiKeyDialog } from './ApiKeyDialog.tsx'
import { loadConfig, useAi } from '../ai/client.ts'
import { Saver, type SaveState } from '../saver.ts'
import {
  FIXTURE_INFO,
  FIXTURE_KINDS,
  PLACEMENT_LABELS,
  RUN_INFO,
  RUN_KINDS,
  RUN_PLACEMENTS,
  type FixtureKind,
  type RunKind,
  type RunPlacement,
} from '@romslig/shared'

const TOOLS: { id: Tool; label: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Velg', icon: '↖', key: 'v' },
  { id: 'wall', label: 'Vegg', icon: '▭', key: 'w' },
  { id: 'door', label: 'Dør', icon: '🚪', key: 'd' },
  { id: 'window', label: 'Vindu', icon: '▤', key: 'n' },
  { id: 'opening', label: 'Åpning', icon: '⬚', key: 'o' },
  { id: 'room', label: 'Rom', icon: '⬠', key: 'r' },
  { id: 'calibrate', label: 'Kalibrer', icon: '📏', key: 'k' },
  { id: 'fixture', label: 'Punkt', icon: '🔌', key: 'p' },
  { id: 'run', label: 'Føring', icon: '〰', key: 'f' },
  { id: 'ceiling', label: 'Himling', icon: '▥', key: 'h' },
]

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Lagret',
  saving: 'Lagrer…',
  retrying: 'Ikke lagret, prøver igjen',
  error: 'Ikke lagret – prøv igjen',
  conflict: 'Ikke lagret (konflikt)',
}

interface SaveStatus {
  state: SaveState
  /** What went wrong, for `retrying` and `error`. */
  message?: string
}

/**
 * Saves that were still on their way when an editor was closed, by project id. Opening the same
 * project again waits for its save, so it neither shows the old copy nor conflicts with itself.
 */
const leaving = new Map<string, Promise<void>>()

export function Editor({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.project)
  const [error, setError] = useState<string | null>(null)
  const [save, setSave] = useState<SaveStatus>({ state: 'saved' })
  const inspectorWide = useStore((s) => s.inspectorTab === 'assistent' && !s.selection)
  const keyDialogOpen = useAi((s) => s.keyDialogOpen)
  const typing = useTypingAsOneUndoStep()

  // AI mode (byok or server) for the key button and the AI panels
  useEffect(() => {
    loadConfig().catch((e: unknown) => console.warn('config:', e))
  }, [])

  const saverRef = useRef<Saver | null>(null)
  /** True while a project from the server is put into the store, so the load is not saved back. */
  const loadingRef = useRef(false)

  const loadFromServer = async (saver: Saver) => {
    await leaving.get(projectId)
    const p = await api.get(projectId)
    if (saverRef.current !== saver) return // the editor was closed while the project was on its way
    loadingRef.current = true
    try {
      useStore.getState().load(p)
      resetHistory()
    } finally {
      loadingRef.current = false
    }
    saver.loaded(p.version)
  }

  // Load, autosave, and save what is left when the editor is closed
  useEffect(() => {
    const saver = new Saver({
      current: () => useStore.getState().project,
      save: api.save,
      onState: (state, message) => {
        setSave({ state, message })
        if (state === 'error') setError(message ?? null)
      },
    })
    saverRef.current = saver
    useStore.setState({ project: null })
    loadFromServer(saver).catch((e) => setError(e.message))

    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.project && s.project !== prev.project && !loadingRef.current) saver.changed()
    })
    // A tab that is hidden may never come back (phone, closed laptop): don't wait for the quiet moment
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void saver.flush()
    }
    // Closing the tab cannot wait for a request, so ask first when something is not saved yet
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!saver.unsaved) return
      void saver.flush()
      e.preventDefault()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('beforeunload', onBeforeUnload)
      saverRef.current = null
      const done = saver.leave()
      leaving.set(projectId, done)
      void done.finally(() => {
        if (leaving.get(projectId) === done) leaving.delete(projectId)
      })
    }
    // eslint-disable-next-line @eslint-react/exhaustive-deps -- one saver per opened project
  }, [projectId])

  const conflict = save.state === 'conflict'
  const resolveConflict = async (keepMine: boolean) => {
    const saver = saverRef.current
    if (!saver) return
    try {
      // "Keep mine": take the newest version number, then save our copy over it
      if (keepMine) await saver.overwrite((await api.get(projectId)).version)
      else await loadFromServer(saver)
    } catch (e) {
      setError((e as Error).message)
    }
  }

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
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        useStore.getState().duplicateSelected()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        useStore.getState().deleteSelected()
      } else if (
        !mod &&
        ['q', 'e'].includes(e.key.toLowerCase()) &&
        useStore.getState().selection?.kind === 'furniture'
      ) {
        const step = e.shiftKey ? 15 : 90
        useStore
          .getState()
          .rotateFurniture(useStore.getState().selection!.id, e.key.toLowerCase() === 'q' ? -step : step)
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
    <div className={`editor${inspectorWide ? ' wide-inspector' : ''}`} {...typing}>
      <TopBar save={save} onRetry={() => void saverRef.current?.flush()} />
      <Toolbar />
      <main className="views">
        <ViewPanes />
      </main>
      <Inspector />
      {conflict && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-labelledby="conflict-title">
            <h3 id="conflict-title">Endret på en annen enhet</h3>
            <p>
              Prosjektet er lagret fra en annen fane eller enhet etter at du åpnet det. Endringene dine siden da er ikke
              lagret.
            </p>
            <div className="row">
              <button className="primary" onClick={() => void resolveConflict(false)}>
                Last inn siste versjon
              </button>
              <button onClick={() => void resolveConflict(true)}>Behold mine endringer</button>
            </div>
            <p className="muted">«Behold mine» overskriver det som ble lagret fra den andre enheten.</p>
          </div>
        </div>
      )}
      {keyDialogOpen && <ApiKeyDialog />}
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
  if (view === 'compare') return <CompareView />
  return (
    <div className={`views-inner ${view}`}>
      {view !== '3d' && <Plan2D />}
      {view !== '2d' && <Viewer3D />}
    </div>
  )
}

function TopBar({ save, onRetry }: { save: SaveStatus; onRetry: () => void }) {
  const project = useStore((s) => s.project)!
  const view = useStore((s) => s.view)
  const { canUndo, canRedo } = useHistory()
  const { setView, updateProject, setActiveScenario, duplicateScenario, renameScenario, deleteScenario } =
    useStore.getState()
  const scenario = activeScenario(project)
  const views: { id: ViewMode; label: string }[] = [
    { id: '2d', label: '2D' },
    { id: 'split', label: '2D + 3D' },
    { id: '3d', label: '3D' },
    { id: 'compare', label: 'Sammenlign' },
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
      <button title="Angre (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
        ↶
      </button>
      <button title="Gjør om (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
        ↷
      </button>
      <div className="segmented">
        {views.map((v) => (
          <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      <button
        title="Skriv ut: plan med mål, romliste og møbelliste"
        aria-label="Skriv ut"
        onClick={() => (window.location.hash = `#/p/${project.id}/print`)}
      >
        🖨
      </button>
      <ApiKeyButton />
      {save.state === 'retrying' || save.state === 'error' ? (
        <button className={`save-state ${save.state}`} title={save.message} onClick={onRetry}>
          {SAVE_LABELS[save.state]}
        </button>
      ) : (
        <span className={`save-state ${save.state}`} role="status">
          {SAVE_LABELS[save.state]}
        </span>
      )}
    </header>
  )
}

function Toolbar() {
  const tool = useStore((s) => s.tool)
  const thickness = useStore((s) => s.wallThickness)
  const fixtureKind = useStore((s) => s.fixtureKind)
  const runKind = useStore((s) => s.runKind)
  const runPlacement = useStore((s) => s.runPlacement)
  const setInstallationSettings = useStore((s) => s.setInstallationSettings)
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
      {tool === 'fixture' && (
        <label className="thickness" title="Type punkt">
          Type
          <select
            value={fixtureKind}
            onChange={(e) => setInstallationSettings({ fixtureKind: e.target.value as FixtureKind })}
          >
            {FIXTURE_KINDS.map((k) => (
              <option key={k} value={k}>
                {FIXTURE_INFO[k].name}
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === 'run' && (
        <>
          <label className="thickness" title="Type føring">
            Type
            <select value={runKind} onChange={(e) => setInstallationSettings({ runKind: e.target.value as RunKind })}>
              {RUN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RUN_INFO[k].name}
                </option>
              ))}
            </select>
          </label>
          <label className="thickness" title="Hvor føringen ligger">
            Ligger
            <select
              value={runPlacement}
              onChange={(e) => setInstallationSettings({ runPlacement: e.target.value as RunPlacement })}
            >
              {RUN_PLACEMENTS.map((k) => (
                <option key={k} value={k}>
                  {PLACEMENT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </nav>
  )
}
