import { create } from 'zustand'
import { temporal } from 'zundo'
import {
  DEFAULTS,
  fitRoomToWalls,
  followWalls,
  getCatalogItem,
  itemSize,
  moveWall,
  moveWallEndpoint,
  setWallLength,
  splitWall,
  newId,
  redetectRooms,
  removeRoom,
  removeWall,
  replaceGeometry,
  rescaleScenario,
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
  fitOpening,
  type Opening,
  type Note,
  type OpeningKind,
  type Project,
  type Room,
  type Scenario,
  type Vec2,
  type Wall,
  type WallEnd,
  copyFurnitureToScenario,
  furnitureCopies,
  moveFurnitureBy,
} from '@romslig/shared'
import {
  existingIn,
  NO_SELECTION,
  selectedIds,
  toggled,
  withAdded,
  type Selection,
  type SelectedItem,
} from './selection.ts'

export type { Selection, SelectedItem, SelectionKind } from './selection.ts'

export type Tool =
  'select' | 'wall' | 'door' | 'window' | 'opening' | 'room' | 'calibrate' | 'measure' | 'fixture' | 'run' | 'ceiling'
export type ViewMode = '2d' | '3d' | 'split' | 'compare'
export type InspectorTab = 'oversikt' | 'moebler' | 'assistent'

interface State {
  project: Project | null
  tool: Tool
  view: ViewMode
  /**
   * The side panels (tools and inspector) are hidden and the views get the whole width. Entered
   * from 2D + 3D it shows 3D alone; `viewBeforeFocus` is what leaving it goes back to.
   */
  focus: boolean
  viewBeforeFocus: ViewMode | null
  /** What is selected, in the order it was selected; empty when nothing is. Not part of the undo history. */
  selection: Selection
  suggestion: DigitizeSuggestion | null
  inspectorTab: InspectorTab
  /** True while a furniture item is dragged in 3D (orbit controls pause). */
  dragging3d: boolean
  /** True while a wall, room, ceiling, run or calibration is being drawn in 2D (set by the drawing tool). */
  drawing: boolean
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
  setFocus(on: boolean): void
  /** Selects just this item (replacing the selection), or nothing with null. */
  select(item: SelectedItem | null): void
  /** A click on an item: with `additive` (Shift) it is toggled in or out of the selection, else selected alone. */
  pick(item: SelectedItem, additive: boolean): void
  /** Replaces the selection, or with `add` adds to it (a selection rectangle). */
  setSelection(items: readonly SelectedItem[], add?: boolean): void
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
  /**
   * Moves one end of a wall to `to` while it is dragged. `base` is the variant as it was when the
   * drag started: connected walls, openings and rooms are worked out from there on every move.
   */
  dragWallEndpoint(base: Scenario, wallId: string, end: WallEnd, to: Vec2): void
  /** Moves the wall's end `b` along the wall so it gets this length; attached walls follow. */
  setWallLength(wallId: string, length: number): void
  /**
   * Moves a whole wall parallel to itself, `offset` metres along its left normal, while it is
   * dragged. Like dragWallEndpoint, everything is worked out from `base` on every move.
   */
  dragWall(base: Scenario, wallId: string, offset: number): void
  /** Splits a wall in two at `at` metres from its start (see splitWall); the first piece keeps the id. */
  splitWall(wallId: string, at: number): void
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
  /** Turns every selected furniture item about its own centre, in one undo step. */
  rotateSelectedFurniture(deltaDeg: number): void
  /**
   * Moves furniture items together while they are dragged: `base` is how they stood when the drag
   * started and `delta` how far the pointer has gone since. No wall snapping (see moveFurnitureBy).
   */
  moveFurnitureGroup(base: readonly FurnitureItem[], delta: Vec2): void
  /** Copies the selected furniture and openings next to the originals and selects the copies (one undo step). */
  duplicateSelected(): void
  /** Removes everything selected in one undo step; walls via removeWall, so nothing points at them. */
  deleteSelected(): void
  /**
   * Copies the selected furniture into another variant (new ids, same place); the active variant
   * and the selection stay. Returns how many items were copied.
   */
  copySelectedFurnitureTo(scenarioId: string): number
  detectRooms(): number
  calibrate(pxDistance: number, meters: number): void

  setInspectorTab(tab: InspectorTab): void
  setDrawing(drawing: boolean): void
  /**
   * Escape in the editor: a drawing in progress ends and the tool goes back to Velg (the drawing
   * tool drops its points itself); otherwise the selection is cleared; with nothing selected the
   * tool goes back to Velg.
   */
  escape(): void
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

/** An opening is never wider than its wall, and never sticks out past the end of it. */
function inWall(o: Opening, s: Scenario): Opening {
  const wall = s.walls.find((w) => w.id === o.wallId)
  return wall ? fitOpening(o, wall) : o
}

export const activeScenario = (p: Project): Scenario =>
  p.scenarios.find((s) => s.id === p.activeScenarioId) ?? p.scenarios[0]!

/** How many undo steps are kept. */
const HISTORY_LIMIT = 200

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      project: null,
      tool: 'select',
      view: 'split',
      focus: false,
      viewBeforeFocus: null,
      selection: NO_SELECTION,
      suggestion: null,
      dragging3d: false,
      drawing: false,
      inspectorTab: 'oversikt',
      wallThickness: DEFAULTS.interiorWallThickness,
      fixtureKind: 'outlet',
      runKind: 'water_cold',
      runPlacement: 'wall',
      showInstallations: true,

      load: (p) =>
        set({
          project: p,
          selection: NO_SELECTION,
          suggestion: null,
          tool: 'select',
          focus: false,
          viewBeforeFocus: null,
        }),
      setTool: (tool) => set({ tool }),
      setView: (view) => set({ view, viewBeforeFocus: null }),
      setFocus: (on) => {
        const { focus, view, viewBeforeFocus } = get()
        if (on === focus) return
        if (on) set({ focus: true, tool: 'select', ...(view === 'split' ? { view: '3d', viewBeforeFocus: view } : {}) })
        else set({ focus: false, view: viewBeforeFocus ?? view, viewBeforeFocus: null })
      },
      select: (item) => set({ selection: item ? [item] : NO_SELECTION }),
      pick: (item, additive) => (additive ? set({ selection: toggled(get().selection, item) }) : get().select(item)),
      setSelection: (items, add = false) => set({ selection: add ? withAdded(get().selection, items) : [...items] }),
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
        get().select({ kind: 'run', id: run.id })
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
        get().select({ kind: 'ceiling', id: c.id })
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
        get().updateScenario((s) => {
          const next = { ...s, walls: s.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) }
          // Rooms are measured to the inside of their walls, so they change with the wall's shape
          return 'a' in patch || 'b' in patch || 'thickness' in patch ? followWalls(s.walls, next) : next
        }),
      dragWallEndpoint: (base, wallId, end, to) =>
        get().updateScenario((s) => (s.id === base.id ? moveWallEndpoint(base, wallId, end, to) : s)),
      setWallLength: (wallId, length) => get().updateScenario((s) => setWallLength(s, wallId, length)),
      dragWall: (base, wallId, offset) =>
        get().updateScenario((s) => (s.id === base.id ? moveWall(base, wallId, offset) : s)),
      splitWall: (wallId, at) => {
        get().updateScenario((s) => splitWall(s, wallId, at))
        get().select({ kind: 'wall', id: wallId })
      },

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
        get().updateScenario((s) => ({ ...s, openings: [...s.openings, inWall(o, s)] }))
        get().select({ kind: 'opening', id: o.id })
      },
      updateOpening: (id, patch) =>
        get().updateScenario((s) => ({
          ...s,
          openings: s.openings.map((o) => (o.id === id ? inWall({ ...o, ...patch }, s) : o)),
        })),

      addRoom: (drawn) => {
        const s = activeScenario(get().project!)
        // Corners are clicked on the wall centre lines; a room is measured to the inside of its walls
        const polygon = fitRoomToWalls(drawn, s.walls)
        const r: Room = { id: newId('r_'), name: `Rom ${s.rooms.length + 1}`, type: 'annet', polygon, statedArea: null }
        get().updateScenario((sc) => ({ ...sc, rooms: [...sc.rooms, r] }))
        get().select({ kind: 'room', id: r.id })
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
        get().select({ kind: 'furniture', id: item.id })
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
      rotateSelectedFurniture: (deltaDeg) => {
        const ids = new Set(selectedIds(get().selection, 'furniture'))
        if (!ids.size) return
        get().updateScenario((s) => ({
          ...s,
          furniture: s.furniture.map((f) =>
            ids.has(f.id) ? { ...f, rotation: (((f.rotation + deltaDeg) % 360) + 360) % 360 } : f,
          ),
        }))
      },
      moveFurnitureGroup: (base, delta) => get().updateScenario((s) => moveFurnitureBy(s, base, delta)),
      duplicateSelected: () => {
        const sel = get().selection
        const sc = activeScenario(get().project!)
        const furniture = furnitureCopies(sc, selectedIds(sel, 'furniture'), { x: 0.3, y: 0.3 })
        // An opening's copy goes along its wall, just past the original (and stays within the wall)
        const openingIds = new Set(selectedIds(sel, 'opening'))
        const openings = sc.openings
          .filter((o) => openingIds.has(o.id))
          .map((o) => inWall({ ...o, id: newId('o_'), offset: o.offset + o.width + 0.1 }, sc))
        if (!furniture.length && !openings.length) return
        get().updateScenario((s) => ({
          ...s,
          furniture: [...s.furniture, ...furniture],
          openings: [...s.openings, ...openings],
        }))
        get().setSelection([
          ...furniture.map((f) => ({ kind: 'furniture' as const, id: f.id })),
          ...openings.map((o) => ({ kind: 'opening' as const, id: o.id })),
        ])
      },

      deleteSelected: () => {
        const sel = get().selection
        if (!sel.length) return
        const ids = (kind: SelectedItem['kind']) => new Set(selectedIds(sel, kind))
        get().updateScenario((s) => {
          const furniture = ids('furniture')
          const fixtures = ids('fixture')
          const runs = ids('run')
          const ceilings = ids('ceiling')
          const openings = ids('opening')
          let next: Scenario = {
            ...s,
            furniture: s.furniture.filter((f) => !furniture.has(f.id)),
            fixtures: s.fixtures.filter((x) => !fixtures.has(x.id)),
            runs: s.runs.filter((r) => !runs.has(r.id)),
            loweredCeilings: s.loweredCeilings.filter((c) => !ceilings.has(c.id)),
            openings: s.openings.filter((o) => !openings.has(o.id)),
          }
          for (const id of ids('room')) next = removeRoom(next, id)
          for (const id of ids('wall')) next = removeWall(next, id)
          return next
        })
        set({ selection: NO_SELECTION })
      },

      copySelectedFurnitureTo: (scenarioId) => {
        const p = get().project
        if (!p) return 0
        const { project, copies } = copyFurnitureToScenario(
          p,
          p.activeScenarioId,
          selectedIds(get().selection, 'furniture'),
          scenarioId,
        )
        if (copies.length) set({ project })
        return copies.length
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
            scenarios: p.scenarios.map((s) => rescaleScenario(s, k)),
          },
        })
      },

      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      setDrawing: (drawing) => set({ drawing }),
      escape: () => {
        const { drawing, selection, tool } = get()
        if (drawing) set({ tool: 'select' })
        else if (selection.length) set({ selection: NO_SELECTION })
        else if (tool !== 'select') set({ tool: 'select' })
      },
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
      /**
       * Takes the suggested walls, openings and rooms into the active variant. The suggestion comes
       * with its own image scale, so everything else that was placed over the image (furniture,
       * installations, the other variants) is rescaled to it, exactly as when calibrating.
       */
      acceptSuggestion: () => {
        const sug = get().suggestion
        const p = get().project
        if (!sug || !p) return
        const k = p.calibration.pxPerMeter / sug.pxPerMeter
        set({
          project: {
            ...p,
            calibration: {
              pxPerMeter: sug.pxPerMeter,
              calibrated: p.calibration.calibrated || sug.scaleSource !== 'none',
            },
            scenarios: p.scenarios.map((s) => {
              const scaled = rescaleScenario(s, k)
              return s.id === p.activeScenarioId ? replaceGeometry(scaled, sug) : scaled
            }),
          },
          suggestion: null,
          selection: NO_SELECTION,
        })
      },

      setActiveScenario: (id) => {
        // Which variant is shown is not a change to the drawing, so it is not an undo step
        untracked(() => get().updateProject((p) => ({ ...p, activeScenarioId: id })))
        set({ selection: NO_SELECTION })
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

// The selection never points at something that is gone (after undo, a variant switch or a change
// made by the assistant), so the inspector and the keyboard shortcuts always act on something real.
// Items that are gone are dropped; the rest stay selected.
useStore.subscribe((s, prev) => {
  if (s.project === prev.project || !s.selection.length) return
  const kept = s.project ? existingIn(s.selection, activeScenario(s.project)) : NO_SELECTION
  if (kept !== s.selection) useStore.setState({ selection: kept.length ? kept : NO_SELECTION })
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
