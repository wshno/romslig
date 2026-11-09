import { create } from 'zustand'
import { temporal } from 'zundo'
import {
  DEFAULTS,
  detectRoomPolygons,
  newId,
  pointInPolygon,
  polygonCentroid,
  type DigitizeSuggestion,
  type Opening,
  type OpeningKind,
  type Project,
  type Room,
  type Scenario,
  type Vec2,
  type Wall,
} from '@romslig/shared'

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'opening' | 'room' | 'calibrate'
export type ViewMode = '2d' | '3d' | 'split'
export type Selection = { kind: 'wall' | 'opening' | 'room'; id: string } | null

interface State {
  project: Project | null
  tool: Tool
  view: ViewMode
  selection: Selection
  suggestion: DigitizeSuggestion | null
  /** Wall thickness used by the wall tool */
  wallThickness: number

  load(p: Project): void
  setTool(t: Tool): void
  setView(v: ViewMode): void
  select(s: Selection): void
  setWallThickness(t: number): void
  updateProject(fn: (p: Project) => Project): void
  updateScenario(fn: (s: Scenario) => Scenario): void

  addWall(a: Vec2, b: Vec2): Wall
  updateWall(id: string, patch: Partial<Wall>): void
  addOpening(kind: OpeningKind, wallId: string, offset: number): void
  updateOpening(id: string, patch: Partial<Opening>): void
  addRoom(polygon: Vec2[]): void
  updateRoom(id: string, patch: Partial<Room>): void
  deleteSelected(): void
  detectRooms(): number
  calibrate(pxDistance: number, meters: number): void

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

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      project: null,
      tool: 'select',
      view: 'split',
      selection: null,
      suggestion: null,
      wallThickness: DEFAULTS.interiorWallThickness,

      load: (p) => set({ project: p, selection: null, suggestion: null, tool: 'select' }),
      setTool: (tool) => set({ tool }),
      setView: (view) => set({ view }),
      select: (selection) => set({ selection }),
      setWallThickness: (wallThickness) => set({ wallThickness }),

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
        const o: Opening = { id: newId('o_'), wallId, kind, offset, width: d.width, height: d.height, sill: d.sill }
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

      deleteSelected: () => {
        const sel = get().selection
        if (!sel) return
        get().updateScenario((s) => {
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
        const s = activeScenario(get().project!)
        const polys = detectRoomPolygons(s.walls)
        const rooms: Room[] = polys.map((poly, i) => {
          const prev = s.rooms.find((r) => r.polygon.length >= 3 && pointInPolygon(polygonCentroid(r.polygon), poly))
          return prev
            ? { ...prev, polygon: poly }
            : { id: newId('r_'), name: `Rom ${i + 1}`, type: 'annet', polygon: poly, statedArea: null }
        })
        get().updateScenario((sc) => ({ ...sc, rooms }))
        return rooms.length
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
            })),
          },
        })
      },

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
        get().updateProject((p) => ({ ...p, activeScenarioId: id }))
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
      limit: 200,
    },
  ),
)

export const useScenario = () => useStore((s) => (s.project ? activeScenario(s.project) : null))
export const undo = () => useStore.temporal.getState().undo()
export const redo = () => useStore.temporal.getState().redo()

/**
 * Groups continuous edits (dragging) into a single undo step: call beginGesture()
 * on drag start and endGesture() on drag end.
 */
let gestureSnapshot: Project | null = null
export function beginGesture() {
  gestureSnapshot = useStore.getState().project
  useStore.temporal.getState().pause()
}
export function endGesture() {
  const t = useStore.temporal.getState()
  const final = useStore.getState().project
  if (gestureSnapshot && final !== gestureSnapshot) {
    useStore.setState({ project: gestureSnapshot })
    t.resume()
    useStore.setState({ project: final })
  } else t.resume()
  gestureSnapshot = null
}

if (import.meta.env.DEV) (window as unknown as { __romslig: unknown }).__romslig = useStore
