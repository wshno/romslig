import { create } from 'zustand'
import { temporal } from 'zundo'
import {
  DEFAULTS,
  getCatalogItem,
  itemSize,
  newId,
  redetectRooms,
  roomAt,
  snapToWall,
  type ChatMessage,
  type DigitizeSuggestion,
  type FurnitureItem,
  type CustomFurniture,
  setCustomCatalog,
  type Fixture,
  type FixtureKind,
  type LoweredCeiling,
  type Run,
  type RunKind,
  type RunPlacement,
  FIXTURE_INFO,
  RUN_INFO,
  defaultRunHeight,
  type Opening,
  type Note,
  type OpeningKind,
  type Project,
  type Room,
  type Scenario,
  type Vec2,
  type Wall,
} from '@romslig/shared'

export type Tool =
  'select' | 'wall' | 'door' | 'window' | 'opening' | 'room' | 'calibrate' | 'fixture' | 'run' | 'ceiling'
export type ViewMode = '2d' | '3d' | 'split' | 'compare'
export type InspectorTab = 'oversikt' | 'moebler' | 'assistent'
export type Selection = {
  kind: 'wall' | 'opening' | 'room' | 'furniture' | 'fixture' | 'run' | 'ceiling'
  id: string
} | null

interface State {
  project: Project | null
  tool: Tool
  view: ViewMode
  selection: Selection
  suggestion: DigitizeSuggestion | null
  inspectorTab: InspectorTab
  /** True while a furniture item is dragged in 3D (orbit controls pause). */
  dragging3d: boolean
  /** Wall thickness used by the wall tool */
  wallThickness: number
  /** Settings for the installation tools */
  fixtureKind: FixtureKind
  runKind: RunKind
  runPlacement: RunPlacement
  showInstallations: boolean

  load(p: Project): void
  setTool(t: Tool): void
  setView(v: ViewMode): void
  select(s: Selection): void
  setWallThickness(t: number): void
  setInstallationSettings(
    patch: Partial<Pick<State, 'fixtureKind' | 'runKind' | 'runPlacement' | 'showInstallations'>>,
  ): void
  addFixture(kind: FixtureKind, at: Vec2, wallId: string | null): void
  updateFixture(id: string, patch: Partial<Fixture>): void
  addRun(points: Vec2[]): void
  updateRun(id: string, patch: Partial<Run>): void
  addLoweredCeiling(polygon: Vec2[]): void
  updateLoweredCeiling(id: string, patch: Partial<LoweredCeiling>): void
  updateProject(fn: (p: Project) => Project): void
  updateScenario(fn: (s: Scenario) => Scenario): void

  addWall(a: Vec2, b: Vec2): Wall
  updateWall(id: string, patch: Partial<Wall>): void
  addOpening(kind: OpeningKind, wallId: string, offset: number): void
  updateOpening(id: string, patch: Partial<Opening>): void
  addRoom(polygon: Vec2[]): void
  updateRoom(id: string, patch: Partial<Room>): void
  /** Places a catalog item; snaps it to a wall when dropped close to one. */
  addFurniture(catalogId: string, at: Vec2, opts?: { snap?: boolean; rotation?: number }): void
  /** Adds several finished items in one undo step. */
  addFurnitureItems(items: FurnitureItem[]): void
  /** Adds furniture types of the project's own (not in the catalog). */
  addCustomFurniture(items: CustomFurniture[]): void
  updateFurniture(id: string, patch: Partial<FurnitureItem>): void
  /** Moves an item, snapping it back against a nearby wall unless snap is false. */
  moveFurniture(id: string, to: Vec2, snap: boolean): void
  rotateFurniture(id: string, deltaDeg: number): void
  duplicateSelected(): void
  deleteSelected(): void
  detectRooms(): number
  calibrate(pxDistance: number, meters: number): void

  setInspectorTab(tab: InspectorTab): void
  /**
   * Stores a finished assistant exchange: both chat messages, the new variants and the notes for
   * the variant the question was asked from.
   */
  applyAssistantResult(r: {
    question: ChatMessage
    answer: ChatMessage
    scenarios: Scenario[]
    notes: Note[]
    baseScenarioId: string
  }): void
  deleteNote(scenarioId: string, noteId: string): void
  setSuggestion(s: DigitizeSuggestion | null): void
  acceptSuggestion(): void

  setActiveScenario(id: string): void
  duplicateScenario(name: string): void
  renameScenario(id: string, name: string): void
  deleteScenario(id: string): void
}

export const activeScenario = (p: Project): Scenario =>
  p.scenarios.find((s) => s.id === p.activeScenarioId) ?? p.scenarios[0]!

const scaleVec = (v: Vec2, k: number): Vec2 => ({ x: v.x * k, y: v.y * k })

/** How many undo steps are kept. */
const HISTORY_LIMIT = 200

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      project: null,
      tool: 'select',
      view: 'split',
      selection: null,
      suggestion: null,
      dragging3d: false,
      inspectorTab: 'oversikt',
      wallThickness: DEFAULTS.interiorWallThickness,
      fixtureKind: 'outlet',
      runKind: 'water_cold',
      runPlacement: 'wall',
      showInstallations: true,

      load: (p) => set({ project: p, selection: null, suggestion: null, tool: 'select' }),
      setTool: (tool) => set({ tool }),
      setView: (view) => set({ view }),
      select: (selection) => set({ selection }),
      setWallThickness: (wallThickness) => set({ wallThickness }),
      setInstallationSettings: (patch) => set(patch),

      addFixture: (kind, at, wallId) => {
        const p = get().project!
        const info = FIXTURE_INFO[kind]
        const z = kind === 'ceiling_light' ? p.ceilingHeight : info.height
        const fx: Fixture = { id: newId('fx_'), kind, x: at.x, y: at.y, z, wallId, label: null, note: null }
        get().updateScenario((s) => ({ ...s, fixtures: [...s.fixtures, fx] }))
      },
      updateFixture: (id, patch) =>
        get().updateScenario((s) => ({
          ...s,
          fixtures: s.fixtures.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      addRun: (points) => {
        const { runKind, runPlacement, project } = get()
        const run: Run = {
          id: newId('run_'),
          kind: runKind,
          placement: runPlacement,
          points,
          z: defaultRunHeight(runPlacement, project!.ceilingHeight),
          diameter: RUN_INFO[runKind].diameter,
          label: null,
          note: null,
        }
        get().updateScenario((s) => ({ ...s, runs: [...s.runs, run] }))
        set({ selection: { kind: 'run', id: run.id } })
      },
      updateRun: (id, patch) =>
        get().updateScenario((s) => ({ ...s, runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      addLoweredCeiling: (polygon) => {
        const c: LoweredCeiling = {
          id: newId('lc_'),
          polygon,
          height: Math.max(1.9, get().project!.ceilingHeight - 0.3),
          label: null,
        }
        get().updateScenario((s) => ({ ...s, loweredCeilings: [...s.loweredCeilings, c] }))
        set({ selection: { kind: 'ceiling', id: c.id } })
      },
      updateLoweredCeiling: (id, patch) =>
        get().updateScenario((s) => ({
          ...s,
          loweredCeilings: s.loweredCeilings.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),

      updateProject: (fn) => {
        const p = get().project
        if (p) set({ project: fn(p) })
      },
      updateScenario: (fn) =>
        get().updateProject((p) => ({
          ...p,
          scenarios: p.scenarios.map((s) => (s.id === p.activeScenarioId ? fn(s) : s)),
        })),

      addWall: (a, b) => {
        const p = get().project!
        const wall: Wall = {
          id: newId('w_'),
          a,
          b,
          thickness: get().wallThickness,
          height: p.ceilingHeight,
          loadBearing: 'unknown',
          exterior: get().wallThickness >= 0.2,
        }
        get().updateScenario((s) => ({ ...s, walls: [...s.walls, wall] }))
        return wall
      },
      updateWall: (id, patch) =>
        get().updateScenario((s) => ({ ...s, walls: s.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),

      addOpening: (kind, wallId, offset) => {
        const d = DEFAULTS[kind]
        const o: Opening = {
          id: newId('o_'),
          wallId,
          kind,
          offset,
          width: d.width,
          height: d.height,
          sill: d.sill,
          flip: false,
        }
        get().updateScenario((s) => ({ ...s, openings: [...s.openings, o] }))
        set({ selection: { kind: 'opening', id: o.id } })
      },
      updateOpening: (id, patch) =>
        get().updateScenario((s) => ({
          ...s,
          openings: s.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
        })),

      addRoom: (polygon) => {
        const s = activeScenario(get().project!)
        const r: Room = { id: newId('r_'), name: `Rom ${s.rooms.length + 1}`, type: 'annet', polygon, statedArea: null }
        get().updateScenario((sc) => ({ ...sc, rooms: [...sc.rooms, r] }))
        set({ selection: { kind: 'room', id: r.id } })
      },
      updateRoom: (id, patch) =>
        get().updateScenario((s) => ({ ...s, rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

      addFurniture: (catalogId, at, opts) => {
        const sc = activeScenario(get().project!)
        const cat = getCatalogItem(catalogId)
        const snapped = opts?.snap === false || cat.shape === 'rug' ? null : snapToWall(at, cat, sc.walls)
        const pos = snapped ?? { x: at.x, y: at.y, rotation: opts?.rotation ?? 0 }
        const item: FurnitureItem = {
          id: newId('f_'),
          catalogId,
          x: pos.x,
          y: pos.y,
          rotation: pos.rotation,
          roomId: roomAt(pos, sc.rooms)?.id ?? null,
          size: null,
          label: null,
        }
        get().updateScenario((s) => ({ ...s, furniture: [...s.furniture, item] }))
        set({ selection: { kind: 'furniture', id: item.id } })
      },
      addCustomFurniture: (items) =>
        get().updateProject((p) => ({ ...p, customFurniture: [...p.customFurniture, ...items] })),
      addFurnitureItems: (items) => get().updateScenario((s) => ({ ...s, furniture: [...s.furniture, ...items] })),
      updateFurniture: (id, patch) =>
        get().updateScenario((s) => ({
          ...s,
          furniture: s.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        })),
      moveFurniture: (id, to, snap) => {
        const sc = activeScenario(get().project!)
        const item = sc.furniture.find((f) => f.id === id)
        if (!item) return
        const cat = getCatalogItem(item.catalogId)
        const snapped = snap && cat.shape !== 'rug' ? snapToWall(to, itemSize(item, cat), sc.walls) : null
        const pos = snapped ?? { x: to.x, y: to.y, rotation: item.rotation }
        get().updateFurniture(id, { ...pos, roomId: roomAt(pos, sc.rooms)?.id ?? null })
      },
      rotateFurniture: (id, deltaDeg) => {
        const item = activeScenario(get().project!).furniture.find((f) => f.id === id)
        if (item) get().updateFurniture(id, { rotation: (((item.rotation + deltaDeg) % 360) + 360) % 360 })
      },
      duplicateSelected: () => {
        const sel = get().selection
        if (sel?.kind !== 'furniture') return
        const item = activeScenario(get().project!).furniture.find((f) => f.id === sel.id)
        if (!item) return
        const copy = { ...item, id: newId('f_'), x: item.x + 0.3, y: item.y + 0.3 }
        get().updateScenario((s) => ({ ...s, furniture: [...s.furniture, copy] }))
        set({ selection: { kind: 'furniture', id: copy.id } })
      },

      deleteSelected: () => {
        const sel = get().selection
        if (!sel) return
        get().updateScenario((s) => {
          if (sel.kind === 'furniture') return { ...s, furniture: s.furniture.filter((f) => f.id !== sel.id) }
          if (sel.kind === 'fixture') return { ...s, fixtures: s.fixtures.filter((x) => x.id !== sel.id) }
          if (sel.kind === 'run') return { ...s, runs: s.runs.filter((r) => r.id !== sel.id) }
          if (sel.kind === 'ceiling') return { ...s, loweredCeilings: s.loweredCeilings.filter((c) => c.id !== sel.id) }
          if (sel.kind === 'wall')
            return {
              ...s,
              walls: s.walls.filter((w) => w.id !== sel.id),
              openings: s.openings.filter((o) => o.wallId !== sel.id),
            }
          if (sel.kind === 'opening') return { ...s, openings: s.openings.filter((o) => o.id !== sel.id) }
          return { ...s, rooms: s.rooms.filter((r) => r.id !== sel.id) }
        })
        set({ selection: null })
      },

      /** Re-detects rooms from walls, keeping name/type/stated area of rooms that still exist. */
      detectRooms: () => {
        const next = redetectRooms(activeScenario(get().project!))
        get().updateScenario(() => next)
        return next.rooms.length
      },

      /**
       * Sets the image scale. Geometry was traced over the image, so it is
       * rescaled to stay aligned with the drawing.
       */
      calibrate: (pxDistance, meters) => {
        const p = get().project!
        const newPx = pxDistance / meters
        const k = p.calibration.pxPerMeter / newPx
        set({
          project: {
            ...p,
            calibration: { pxPerMeter: newPx, calibrated: true },
            scenarios: p.scenarios.map((s) => ({
              ...s,
              walls: s.walls.map((w) => ({ ...w, a: scaleVec(w.a, k), b: scaleVec(w.b, k) })),
              openings: s.openings.map((o) => ({ ...o, offset: o.offset * k, width: o.width * k })),
              rooms: s.rooms.map((r) => ({ ...r, polygon: r.polygon.map((v) => scaleVec(v, k)) })),
              furniture: s.furniture.map((f) => ({ ...f, x: f.x * k, y: f.y * k })),
              fixtures: s.fixtures.map((x) => ({ ...x, x: x.x * k, y: x.y * k })),
              runs: s.runs.map((r) => ({ ...r, points: r.points.map((v) => scaleVec(v, k)) })),
              loweredCeilings: s.loweredCeilings.map((c) => ({ ...c, polygon: c.polygon.map((v) => scaleVec(v, k)) })),
            })),
          },
        })
      },

      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      applyAssistantResult: ({ question, answer, scenarios, notes, baseScenarioId }) =>
        get().updateProject((p) => ({
          ...p,
          chat: [...p.chat, question, answer],
          scenarios: [
            ...p.scenarios.map((s) => (s.id === baseScenarioId ? { ...s, notes: [...s.notes, ...notes] } : s)),
            ...scenarios,
          ],
        })),
      deleteNote: (scenarioId, noteId) =>
        get().updateProject((p) => ({
          ...p,
          scenarios: p.scenarios.map((s) =>
            s.id === scenarioId ? { ...s, notes: s.notes.filter((n) => n.id !== noteId) } : s,
          ),
        })),
      setSuggestion: (suggestion) => set({ suggestion }),
      acceptSuggestion: () => {
        const sug = get().suggestion
        const p = get().project
        if (!sug || !p) return
        set({
          project: {
            ...p,
            calibration: {
              pxPerMeter: sug.pxPerMeter,
              calibrated: p.calibration.calibrated || sug.scaleSource !== 'none',
            },
            scenarios: p.scenarios.map((s) =>
              s.id === p.activeScenarioId ? { ...s, walls: sug.walls, openings: sug.openings, rooms: sug.rooms } : s,
            ),
          },
          suggestion: null,
          selection: null,
        })
      },

      setActiveScenario: (id) => {
        // Which variant is shown is not a change to the drawing, so it is not an undo step
        untracked(() => get().updateProject((p) => ({ ...p, activeScenarioId: id })))
        set({ selection: null })
      },
      duplicateScenario: (name) =>
        get().updateProject((p) => {
          const src = activeScenario(p)
          const copy: Scenario = structuredClone({ ...src, id: newId('sc_'), name, parentId: src.id })
          return { ...p, scenarios: [...p.scenarios, copy], activeScenarioId: copy.id }
        }),
      renameScenario: (id, name) =>
        get().updateProject((p) => ({ ...p, scenarios: p.scenarios.map((s) => (s.id === id ? { ...s, name } : s)) })),
      deleteScenario: (id) =>
        get().updateProject((p) => {
          if (p.scenarios.length <= 1) return p
          const scenarios = p.scenarios.filter((s) => s.id !== id)
          return {
            ...p,
            scenarios,
            activeScenarioId: p.activeScenarioId === id ? scenarios[0]!.id : p.activeScenarioId,
          }
        }),
    }),
    {
      partialize: (s) => ({ project: s.project }),
      equality: (a, b) => a.project === b.project,
      limit: HISTORY_LIMIT,
    },
  ),
)

export const useScenario = () => useStore((s) => (s.project ? activeScenario(s.project) : null))

/** True when what is selected is still there in the active variant. */
function selectionExists(p: Project, sel: NonNullable<Selection>): boolean {
  const s = activeScenario(p)
  const lists = {
    wall: s.walls,
    opening: s.openings,
    room: s.rooms,
    furniture: s.furniture,
    fixture: s.fixtures,
    run: s.runs,
    ceiling: s.loweredCeilings,
  }
  return lists[sel.kind].some((x) => x.id === sel.id)
}

// The selection never points at something that is gone (after undo, a variant switch or a change
// made by the assistant), so the inspector and the keyboard shortcuts always act on something real.
useStore.subscribe((s, prev) => {
  if (s.project !== prev.project && s.selection && !(s.project && selectionExists(s.project, s.selection)))
    useStore.setState({ selection: null })
})

const history = () => useStore.temporal.getState()

/** Changes the project without leaving an undo step. */
function untracked(change: () => void) {
  const h = history()
  if (!h.isTracking) return change()
  h.pause()
  try {
    change()
  } finally {
    h.resume()
  }
}

export const undo = () => {
  endGesture()
  history().undo()
}
export const redo = () => {
  endGesture()
  history().redo()
}

/** Forgets the undo history (a project was loaded). */
export function resetHistory() {
  gesture = null
  history().resume()
  history().clear()
}

/**
 * Groups continuous edits (dragging) into a single undo step: call beginGesture() on drag start
 * and endGesture() on drag end. Gestures do not nest: starting one ends the one that was open.
 */
let gesture: { start: Project | null } | null = null
export function beginGesture() {
  endGesture()
  gesture = { start: useStore.getState().project }
  history().pause()
}
export function endGesture() {
  if (!gesture) return
  const { start } = gesture
  gesture = null
  history().resume()
  // The whole gesture is one change: from the project as it was when it started
  if (start && useStore.getState().project !== start)
    useStore.temporal.setState((h) => ({
      pastStates: [...h.pastStates, { project: start }].slice(-HISTORY_LIMIT),
      futureStates: [],
    }))
}

/**
 * Lets a run of changes share one undo step, such as the keystrokes in a field: call before()
 * right before each change and after() right after it. The first change makes a step as usual.
 * The following ones join it for as long as that step is the newest one, so a change made by
 * something else in between (or an undo) starts a new step.
 */
export function mergeSteps() {
  let own: unknown = null
  let top: unknown = null
  let joining = false
  const newest = () => history().pastStates.at(-1) ?? null
  return {
    before() {
      if (joining) history().resume() // after() was never reached, e.g. the change threw
      top = newest()
      joining = own !== null && top === own && history().isTracking
      if (joining) history().pause()
    },
    after() {
      if (joining) {
        joining = false
        history().resume()
      } else if (newest() !== top) own = newest()
    },
  }
}

if (import.meta.env.DEV) (globalThis as unknown as { __romslig: unknown }).__romslig = useStore

// Keep the editor state when Vite hot-replaces this module (e.g. after an edit in packages/shared),
// instead of falling back to an empty store that shows «Laster prosjekt…» until a reload.
if (import.meta.hot) {
  const keep = [
    'project',
    'tool',
    'view',
    'selection',
    'suggestion',
    'wallThickness',
    'inspectorTab',
    'fixtureKind',
    'runKind',
    'runPlacement',
    'showInstallations',
  ] as const
  const prev = import.meta.hot.data.state as Partial<State> | undefined
  if (prev) useStore.setState(prev)
  import.meta.hot.dispose((data) => {
    const s = useStore.getState()
    data.state = Object.fromEntries(keep.map((k) => [k, s[k]]))
  })
}

// The project's own furniture types must be known to getCatalogItem everywhere (2D, 3D, checks).
// zustand calls subscribers synchronously on every change, before React renders.
let lastCustom: unknown = null
useStore.subscribe((state) => {
  const items = state.project?.customFurniture ?? []
  if (items !== lastCustom) {
    lastCustom = items
    setCustomCatalog(items)
  }
})
