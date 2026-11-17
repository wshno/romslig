import { beforeEach, describe, expect, it } from 'vitest'
import { emptyScenario, type Project } from '@romslig/shared'
import {
  activeScenario,
  beginGesture,
  endGesture,
  mergeSteps,
  NO_MODIFIERS,
  redo,
  resetHistory,
  undo,
  useStore,
} from './store.ts'

function newProject(): Project {
  const scenario = emptyScenario()
  return {
    id: 'p_test',
    name: 'Test',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: false },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    chat: [],
    customFurniture: [],
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const state = () => useStore.getState()
const project = () => state().project!
const scenario = () => activeScenario(project())
const history = () => useStore.temporal.getState()
const steps = () => history().pastStates.length
const addWall = (x = 0) => state().addWall({ x, y: 0 }, { x, y: 300 })
const rename = (name: string) => state().updateProject((p) => ({ ...p, name }))

beforeEach(() => {
  state().load(newProject())
  resetHistory()
})

describe('undo history', () => {
  it('starts empty for a loaded project', () => {
    addWall()
    state().load(newProject())
    resetHistory()
    expect(steps()).toBe(0)
    expect(history().futureStates).toHaveLength(0)
  })

  it('undoes and redoes a change', () => {
    addWall()
    expect(steps()).toBe(1)
    undo()
    expect(scenario().walls).toHaveLength(0)
    redo()
    expect(scenario().walls).toHaveLength(1)
  })

  it('tracks changes again after a reset in the middle of a drag', () => {
    beginGesture()
    resetHistory()
    addWall()
    expect(steps()).toBe(1)
  })
})

describe('switching variant', () => {
  it('is not an undo step', () => {
    const first = scenario().id
    state().duplicateScenario('Forslag')
    const copy = scenario().id
    expect(steps()).toBe(1)

    state().setActiveScenario(first)
    state().setActiveScenario(copy)
    state().setActiveScenario(first)
    expect(steps()).toBe(1)
    expect(project().activeScenarioId).toBe(first)
  })

  it('lets undo take back the last change, and shows the variant it was made in', () => {
    const first = scenario().id
    state().duplicateScenario('Forslag')
    const copy = scenario().id
    addWall()
    state().setActiveScenario(first)

    undo()
    expect(project().activeScenarioId).toBe(copy)
    expect(scenario().walls).toHaveLength(0)
    expect(project().scenarios).toHaveLength(2)
  })

  it('keeps what can be redone', () => {
    const first = scenario().id
    state().duplicateScenario('Forslag')
    addWall()
    undo()
    state().setActiveScenario(first)
    expect(history().futureStates).toHaveLength(1)
  })
})

describe('a drag', () => {
  it('is one undo step, back to where it started', () => {
    const wall = addWall()
    beginGesture()
    for (const x of [10, 20, 30]) state().updateWall(wall.id, { a: { x, y: 0 } })
    endGesture()

    expect(steps()).toBe(2)
    undo()
    expect(scenario().walls[0]!.a.x).toBe(0)
    redo()
    expect(scenario().walls[0]!.a.x).toBe(30)
  })

  it('that changes nothing leaves no step', () => {
    addWall()
    beginGesture()
    endGesture()
    expect(steps()).toBe(1)
  })

  it('drops what could be redone, like any other change', () => {
    const wall = addWall()
    rename('A')
    undo()
    beginGesture()
    state().updateWall(wall.id, { a: { x: 10, y: 0 } })
    endGesture()
    expect(history().futureStates).toHaveLength(0)
  })

  it('is ended by undo, which then takes back the whole drag', () => {
    const wall = addWall()
    beginGesture()
    state().updateWall(wall.id, { a: { x: 10, y: 0 } })
    undo()

    expect(scenario().walls[0]!.a.x).toBe(0)
    expect(history().isTracking).toBe(true)
    endGesture() // the drag end that follows does nothing more
    expect(steps()).toBe(1)
    rename('A')
    expect(steps()).toBe(2)
  })

  it('that starts while another is open ends the first one', () => {
    const wall = addWall()
    beginGesture()
    state().updateWall(wall.id, { a: { x: 10, y: 0 } })
    beginGesture()
    state().updateWall(wall.id, { a: { x: 20, y: 0 } })
    endGesture()

    expect(steps()).toBe(3)
    undo()
    expect(scenario().walls[0]!.a.x).toBe(10)
  })

  it('never keeps more steps than the limit', () => {
    for (let i = 0; i < 205; i++) rename(`n${i}`)
    beginGesture()
    rename('dragged')
    endGesture()
    expect(steps()).toBe(200)
    undo()
    expect(project().name).toBe('n204')
  })
})

describe('dragging a room corner', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ]

  it('is one undo step and reassigns the furniture', () => {
    state().addRoom(square)
    const room = scenario().rooms[0]!
    state().addFurniture('sofa-3', { x: 5, y: 1 }, { snap: false })
    expect(scenario().furniture[0]!.roomId).toBeNull()
    const before = steps()

    beginGesture()
    for (const x of [5, 6, 7]) state().setRoomPolygon(room.id, [square[0]!, { x, y: 0 }, square[2]!, square[3]!])
    state().setRoomPolygon(room.id, [square[0]!, { x: 7, y: 0 }, { x: 7, y: 3 }, square[3]!])
    endGesture()

    expect(steps()).toBe(before + 1)
    expect(scenario().rooms[0]!.polygon[1]).toEqual({ x: 7, y: 0 })
    expect(scenario().furniture[0]!.roomId).toBe(room.id)
    undo()
    expect(scenario().rooms[0]!.polygon).toEqual(square)
    expect(scenario().furniture[0]!.roomId).toBeNull()
  })
})

describe('typing in a field', () => {
  const type = (steps: ReturnType<typeof mergeSteps>, text: string) => {
    for (let i = 1; i <= text.length; i++) {
      steps.before()
      rename(text.slice(0, i))
      steps.after()
    }
  }

  it('is one undo step for everything typed', () => {
    type(mergeSteps(), 'Hytta')
    expect(project().name).toBe('Hytta')
    expect(steps()).toBe(1)
    undo()
    expect(project().name).toBe('Test')
    redo()
    expect(project().name).toBe('Hytta')
  })

  it('makes a new step when the field is entered again', () => {
    type(mergeSteps(), 'Hytta')
    type(mergeSteps(), 'Hytta på fjellet')
    expect(steps()).toBe(2)
    undo()
    expect(project().name).toBe('Hytta')
  })

  it('makes a new step after another change came in between', () => {
    const typing = mergeSteps()
    type(typing, 'Hy')
    addWall() // e.g. the assistant answering while the field still has focus
    type(typing, 'Hytta')

    expect(steps()).toBe(3)
    undo()
    expect(project().name).toBe('Hy')
    expect(scenario().walls).toHaveLength(1)
  })

  it('makes a new step after an undo', () => {
    const typing = mergeSteps()
    type(typing, 'Hy')
    undo()
    type(typing, 'Bo')
    expect(steps()).toBe(1)
    undo()
    expect(project().name).toBe('Test')
  })

  it('does not join a step from before when the first keystroke changes nothing', () => {
    addWall()
    const typing = mergeSteps()
    typing.before()
    typing.after() // e.g. a number field with a value that cannot be read yet
    type(typing, 'Hytta')
    expect(steps()).toBe(2)
    undo()
    expect(project().name).toBe('Test')
    expect(scenario().walls).toHaveLength(1)
  })

  it('tracks changes again when a change threw', () => {
    const typing = mergeSteps()
    type(typing, 'Hy')
    typing.before() // after() is never reached
    typing.before()
    typing.after()
    addWall()
    expect(history().isTracking).toBe(true)
    expect(steps()).toBe(2)
  })
})

describe('the selection', () => {
  it('is cleared when undo removes what was selected', () => {
    const wall = addWall()
    state().select({ kind: 'wall', id: wall.id })
    undo()
    expect(state().selection).toEqual([])
  })

  it('is kept when undo leaves what was selected in place', () => {
    const wall = addWall()
    state().select({ kind: 'wall', id: wall.id })
    rename('A')
    undo()
    expect(state().selection).toEqual([{ kind: 'wall', id: wall.id }])
  })

  it('is cleared when undo goes back to a variant without it', () => {
    state().duplicateScenario('Forslag')
    const wall = addWall()
    rename('A')
    state().select({ kind: 'wall', id: wall.id })
    undo()
    expect(state().selection).toEqual([{ kind: 'wall', id: wall.id }])
    undo()
    undo()
    expect(project().scenarios).toHaveLength(1)
    expect(state().selection).toEqual([])
  })

  it('is cleared when what was selected is removed by something else', () => {
    const wall = addWall()
    state().select({ kind: 'wall', id: wall.id })
    state().updateScenario((s) => ({ ...s, walls: [] }))
    expect(state().selection).toEqual([])
  })
})

describe('selecting several things', () => {
  const furnish = (x: number) => {
    state().addFurniture('sofa-3', { x, y: 2 }, { snap: false })
    return scenario().furniture.at(-1)!
  }
  const item = (kind: 'wall' | 'furniture' | 'opening', id: string) => ({ kind, id })

  it('toggles with Shift and replaces without it', () => {
    const a = furnish(1)
    const b = furnish(4)
    const wall = addWall()
    state().select(item('furniture', a.id))
    state().pick(item('furniture', b.id), true)
    state().pick(item('wall', wall.id), true)
    expect(state().selection).toEqual([item('furniture', a.id), item('furniture', b.id), item('wall', wall.id)])
    state().pick(item('furniture', a.id), true)
    expect(state().selection).toEqual([item('furniture', b.id), item('wall', wall.id)])
    state().pick(item('furniture', a.id), false)
    expect(state().selection).toEqual([item('furniture', a.id)])
  })

  it('adds a rectangle selection to what is selected', () => {
    const a = furnish(1)
    const b = furnish(4)
    state().select(item('furniture', a.id))
    state().setSelection([item('furniture', a.id), item('furniture', b.id)], true)
    expect(state().selection).toEqual([item('furniture', a.id), item('furniture', b.id)])
    state().setSelection([item('furniture', b.id)])
    expect(state().selection).toEqual([item('furniture', b.id)])
  })

  it('deletes everything selected in one undo step, walls with their openings', () => {
    const a = furnish(1)
    const b = furnish(4)
    const c = furnish(7)
    const wall = addWall()
    state().addOpening('door', wall.id, 1)
    const keep = addWall(5)
    state().setSelection([item('furniture', a.id), item('furniture', b.id), item('wall', wall.id)])
    const before = steps()
    state().deleteSelected()
    expect(scenario().furniture.map((f) => f.id)).toEqual([c.id])
    expect(scenario().walls.map((w) => w.id)).toEqual([keep.id])
    expect(scenario().openings).toEqual([])
    expect(state().selection).toEqual([])
    expect(steps()).toBe(before + 1)
  })

  it('duplicates the selected furniture and openings and selects the copies', () => {
    const a = furnish(1)
    const b = furnish(4)
    const wall = state().addWall({ x: 0, y: 0 }, { x: 5, y: 0 })
    state().addOpening('window', wall.id, 1)
    const o = scenario().openings[0]!
    state().setSelection([
      item('furniture', a.id),
      item('furniture', b.id),
      item('opening', o.id),
      item('wall', wall.id),
    ])
    const before = steps()
    state().duplicateSelected()
    expect(steps()).toBe(before + 1)
    const copies = scenario().furniture.slice(2)
    expect(copies.map((f) => [f.x, f.y])).toEqual([
      [a.x + 0.3, a.y + 0.3],
      [b.x + 0.3, b.y + 0.3],
    ])
    const oc = scenario().openings[1]!
    expect(oc.wallId).toBe(wall.id)
    expect(oc.offset).toBeCloseTo(o.offset + o.width + 0.1)
    expect(state().selection).toEqual([...copies.map((f) => item('furniture', f.id)), item('opening', oc.id)])
  })

  it('turns every selected furniture item about its own centre, in one step', () => {
    const a = furnish(1)
    const b = furnish(4)
    state().setSelection([item('furniture', a.id), item('furniture', b.id)])
    const before = steps()
    state().rotateSelectedFurniture(-90)
    expect(scenario().furniture.map((f) => [f.x, f.rotation])).toEqual([
      [a.x, 270],
      [b.x, 270],
    ])
    expect(steps()).toBe(before + 1)
  })

  it('moves furniture together from where the drag started', () => {
    const a = furnish(1)
    const b = furnish(4)
    const base = [a, b]
    beginGesture()
    state().moveFurnitureGroup(base, { x: 0.5, y: 0 })
    state().moveFurnitureGroup(base, { x: 1, y: 1 })
    endGesture()
    expect(scenario().furniture.map((f) => [f.x, f.y])).toEqual([
      [a.x + 1, 3],
      [b.x + 1, 3],
    ])
    undo()
    expect(scenario().furniture.map((f) => f.x)).toEqual([a.x, b.x])
  })

  it('copies the selected furniture into another variant', () => {
    const first = project().activeScenarioId
    state().duplicateScenario('Forslag')
    const other = project().activeScenarioId
    state().setActiveScenario(first)
    const a = furnish(1)
    addWall()
    state().setSelection([item('furniture', a.id), item('wall', scenario().walls[0]!.id)])
    expect(state().copySelectedFurnitureTo(other)).toBe(1)
    const target = project().scenarios.find((s) => s.id === other)!
    expect(target.furniture).toHaveLength(1)
    expect(target.furniture[0]!.id).not.toBe(a.id)
    expect(project().activeScenarioId).toBe(first)
    expect(state().selection).toHaveLength(2)
  })

  it('clears all of it with Escape', () => {
    const a = furnish(1)
    const b = furnish(4)
    state().setSelection([item('furniture', a.id), item('furniture', b.id)])
    state().escape()
    expect(state().selection).toEqual([])
  })

  it('drops only the items that undo removes', () => {
    const a = furnish(1)
    const b = furnish(4)
    state().setSelection([item('furniture', a.id), item('furniture', b.id)])
    undo()
    expect(state().selection).toEqual([item('furniture', a.id)])
  })
})

describe('focus mode', () => {
  it('shows 3D alone when entered from 2D + 3D, and goes back to it when left', () => {
    state().setView('split')
    state().setTool('wall')
    state().setFocus(true)
    expect(state()).toMatchObject({ focus: true, view: '3d', tool: 'select' })
    state().setFocus(false)
    expect(state()).toMatchObject({ focus: false, view: 'split' })
  })

  it('keeps 2D or 3D as it is, and keeps a view picked while in focus', () => {
    state().setView('2d')
    state().setFocus(true)
    expect(state().view).toBe('2d')
    state().setFocus(false)
    expect(state().view).toBe('2d')

    state().setView('split')
    state().setFocus(true)
    state().setView('2d') // picked in focus: leaving keeps it
    state().setFocus(false)
    expect(state().view).toBe('2d')
  })

  it('is not part of the undo history, and ends when another project is opened', () => {
    state().setFocus(true)
    expect(steps()).toBe(0)
    state().load(newProject())
    expect(state().focus).toBe(false)
  })
})

describe('escape', () => {
  const wallId = () => scenario().walls[0]!.id

  beforeEach(() => {
    state().setTool('select')
    state().setDrawing(false)
  })

  it('clears the selection first and keeps the tool', () => {
    addWall()
    state().setTool('wall')
    state().select({ kind: 'wall', id: wallId() })
    state().escape()
    expect(state().selection).toEqual([])
    expect(state().tool).toBe('wall')
  })

  it('goes back to Velg when nothing is selected', () => {
    state().setTool('room')
    state().escape()
    expect(state().tool).toBe('select')
    state().escape()
    expect(state().tool).toBe('select')
  })

  it('ends a drawing in progress by going back to Velg, before touching the selection', () => {
    addWall()
    state().setTool('run')
    state().select({ kind: 'wall', id: wallId() })
    state().setDrawing(true)
    state().escape()
    expect(state().tool).toBe('select')
    expect(state().selection).toEqual([{ kind: 'wall', id: wallId() }])
  })

  it('is not part of the undo history', () => {
    addWall()
    state().select({ kind: 'wall', id: wallId() })
    const before = steps()
    state().escape()
    expect(state().selection).toEqual([])
    expect(steps()).toBe(before)
  })
})

describe('modifier toggles', () => {
  const wall = (x: number) => ({ kind: 'wall' as const, id: addWall(x).id })

  beforeEach(() => {
    state().setTool('select')
    useStore.setState({ modifiers: NO_MODIFIERS })
  })

  it('start off, and each one is switched on and off by itself', () => {
    expect(state().modifiers).toEqual({ additive: false, freeAngle: false, noGrid: false })
    state().setModifier('freeAngle', true)
    state().setModifier('noGrid', true)
    expect(state().modifiers).toEqual({ additive: false, freeAngle: true, noGrid: true })
    state().setModifier('freeAngle', false)
    expect(state().modifiers).toEqual({ additive: false, freeAngle: false, noGrid: true })
  })

  it('are not part of the undo history', () => {
    addWall()
    const before = steps()
    state().setModifier('additive', true)
    state().setModifier('noGrid', true)
    expect(steps()).toBe(before)
    undo()
    expect(state().modifiers.additive).toBe(true)
  })

  it('are switched off when the tool changes, however it changes', () => {
    state().setTool('wall')
    state().setModifier('freeAngle', true)
    state().setModifier('noGrid', true)
    state().setTool('room')
    expect(state().modifiers).toEqual({ additive: false, freeAngle: false, noGrid: false })

    // Escape (back to Velg) and focus mode change the tool too
    state().setModifier('noGrid', true)
    state().escape()
    expect(state().tool).toBe('select')
    expect(state().modifiers.noGrid).toBe(false)
    state().setTool('wall')
    state().setModifier('freeAngle', true)
    state().setFocus(true)
    expect(state().modifiers.freeAngle).toBe(false)
    state().setFocus(false)
  })

  it('stay on while the tool stays, also when the same tool is picked again', () => {
    state().setModifier('additive', true)
    state().setTool('select')
    expect(state().modifiers.additive).toBe(true)
  })

  it('«Velg flere» makes a pick add to the selection, as Shift does', () => {
    const a = wall(0)
    const b = wall(100)
    state().pick(a, false)
    state().pick(b, false)
    expect(state().selection).toEqual([b])

    state().setModifier('additive', true)
    state().pick(a, false)
    expect(state().selection).toEqual([b, a])
    // ...and a second pick takes it out again
    state().pick(b, false)
    expect(state().selection).toEqual([a])

    state().setModifier('additive', false)
    state().pick(b, false)
    expect(state().selection).toEqual([b])
  })
})
