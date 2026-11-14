import { beforeEach, describe, expect, it } from 'vitest'
import { emptyScenario, type Project } from '@romslig/shared'
import { activeScenario, beginGesture, endGesture, mergeSteps, redo, resetHistory, undo, useStore } from './store.ts'

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
    expect(state().selection).toBeNull()
  })

  it('is kept when undo leaves what was selected in place', () => {
    const wall = addWall()
    state().select({ kind: 'wall', id: wall.id })
    rename('A')
    undo()
    expect(state().selection).toEqual({ kind: 'wall', id: wall.id })
  })

  it('is cleared when undo goes back to a variant without it', () => {
    state().duplicateScenario('Forslag')
    const wall = addWall()
    rename('A')
    state().select({ kind: 'wall', id: wall.id })
    undo()
    expect(state().selection).toEqual({ kind: 'wall', id: wall.id })
    undo()
    undo()
    expect(project().scenarios).toHaveLength(1)
    expect(state().selection).toBeNull()
  })

  it('is cleared when what was selected is removed by something else', () => {
    const wall = addWall()
    state().select({ kind: 'wall', id: wall.id })
    state().updateScenario((s) => ({ ...s, walls: [] }))
    expect(state().selection).toBeNull()
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
    expect(state().selection).toBeNull()
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
    expect(state().selection).toEqual({ kind: 'wall', id: wallId() })
  })

  it('is not part of the undo history', () => {
    addWall()
    state().select({ kind: 'wall', id: wallId() })
    const before = steps()
    state().escape()
    expect(state().selection).toBeNull()
    expect(steps()).toBe(before)
  })
})
