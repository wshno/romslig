import { beforeEach, describe, expect, it } from 'vitest'
import { emptyScenario, type DigitizeSuggestion, type Project, type Scenario, type Wall } from '@romslig/shared'
import { activeScenario, resetHistory, useStore } from './store.ts'

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
const steps = () => useStore.temporal.getState().pastStates.length

/** A closed 4 × 3 m box of walls. */
function box(): Wall[] {
  const s = state()
  return [
    s.addWall({ x: 0, y: 0 }, { x: 4, y: 0 }),
    s.addWall({ x: 4, y: 0 }, { x: 4, y: 3 }),
    s.addWall({ x: 4, y: 3 }, { x: 0, y: 3 }),
    s.addWall({ x: 0, y: 3 }, { x: 0, y: 0 }),
  ]
}

beforeEach(() => {
  state().load(newProject())
  state().setView('2d')
  state().setTool('select')
  resetHistory()
})

describe('settings', () => {
  it('keeps the wall thickness and the installation settings', () => {
    state().setWallThickness(0.25)
    state().setInstallationSettings({ fixtureKind: 'switch', runKind: 'drain', runPlacement: 'floor' })
    expect(state()).toMatchObject({
      wallThickness: 0.25,
      fixtureKind: 'switch',
      runKind: 'drain',
      runPlacement: 'floor',
    })
    expect(state().addWall({ x: 0, y: 0 }, { x: 1, y: 0 })).toMatchObject({ thickness: 0.25, exterior: true })
  })

  it('keeps the inspector tab and whether something is being drawn', () => {
    state().setInspectorTab('assistent')
    state().setDrawing(true)
    expect(state()).toMatchObject({ inspectorTab: 'assistent', drawing: true })
  })

  it('does nothing when focus is set to what it already is', () => {
    state().setFocus(false)
    expect(state().focus).toBe(false)
  })
})

describe('installations', () => {
  it('adds a fixture at its kind height, a ceiling light at the ceiling', () => {
    state().addFixture('outlet', { x: 1, y: 0.1 }, 'w_1')
    state().addFixture('ceiling_light', { x: 2, y: 1.5 }, null)
    const [outlet, light] = scenario().fixtures
    expect(outlet).toMatchObject({ kind: 'outlet', x: 1, y: 0.1, wallId: 'w_1' })
    expect(light).toMatchObject({ kind: 'ceiling_light', z: 2.4, wallId: null })

    state().updateFixture(outlet!.id, { label: 'Kjøleskap' })
    expect(scenario().fixtures[0]!.label).toBe('Kjøleskap')
    expect(scenario().fixtures[1]!.label).toBeNull()
  })

  it('adds a run with the chosen kind and placement and selects it', () => {
    state().setInstallationSettings({ runKind: 'water_hot', runPlacement: 'ceiling' })
    state().addRun([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ])
    const [run] = scenario().runs
    expect(run).toMatchObject({ kind: 'water_hot', placement: 'ceiling', z: 2.35 })
    expect(state().selection).toEqual([{ kind: 'run', id: run!.id }])

    state().updateRun(run!.id, { note: 'isolert' })
    expect(scenario().runs[0]!.note).toBe('isolert')
  })

  it('adds a lowered ceiling 30 cm down, never below 1.9 m, and selects it', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]
    state().addLoweredCeiling(square)
    expect(scenario().loweredCeilings[0]!.height).toBeCloseTo(2.1)
    expect(state().selection[0]!.kind).toBe('ceiling')

    state().updateProject((p) => ({ ...p, ceilingHeight: 2 }))
    state().addLoweredCeiling(square)
    expect(scenario().loweredCeilings[1]!.height).toBeCloseTo(1.9)

    state().updateLoweredCeiling(scenario().loweredCeilings[0]!.id, { label: 'Bad' })
    expect(scenario().loweredCeilings.map((c) => c.label)).toEqual(['Bad', null])
  })
})

describe('walls', () => {
  it('sets a length, moves an end or the whole wall, and splits it', () => {
    const [w] = box()
    const base = scenario()

    state().setWallLength(w!.id, 5)
    expect(scenario().walls[0]!.b.x).toBeCloseTo(5)

    state().dragWallEndpoint(base, w!.id, 'b', { x: 3, y: 0 })
    expect(scenario().walls[0]!.b.x).toBeCloseTo(3)

    state().dragWall(base, w!.id, 0.5)
    expect(Math.abs(scenario().walls[0]!.a.y)).toBeCloseTo(0.5)

    state().splitWall(w!.id, 1)
    expect(scenario().walls).toHaveLength(5)
    expect(state().selection).toEqual([{ kind: 'wall', id: w!.id }])
  })

  it('ignores a drag that started in another variant', () => {
    const [w] = box()
    const other: Scenario = { ...scenario(), id: 'sc_other' }
    state().dragWallEndpoint(other, w!.id, 'b', { x: 9, y: 0 })
    state().dragWall(other, w!.id, 2)
    expect(scenario().walls[0]!.b).toEqual({ x: 4, y: 0 })
  })
})

describe('openings', () => {
  it('adds an opening that fits in its wall, and keeps it there when changed', () => {
    const [w] = box()
    state().addOpening('door', w!.id, 3.9)
    const [door] = scenario().openings
    expect(door!.offset).toBeLessThan(3.9)
    expect(state().selection).toEqual([{ kind: 'opening', id: door!.id }])

    state().updateOpening(door!.id, { width: 10 })
    expect(scenario().openings[0]!.width).toBeLessThan(10)
  })

  it('keeps an opening whose wall is gone as it is', () => {
    box()
    state().updateScenario((s) => ({
      ...s,
      openings: [
        { id: 'o_x', wallId: 'w_gone', kind: 'window', offset: 0, width: 1, height: 1, sill: 0.9, flip: false },
      ],
    }))
    state().updateOpening('o_x', { width: 20 })
    expect(scenario().openings[0]!.width).toBe(20)
  })
})

describe('rooms', () => {
  it('adds a numbered room inside the walls, renames it and gives it a new outline', () => {
    box()
    state().addRoom([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ])
    const [room] = scenario().rooms
    expect(room!.name).toBe('Rom 1')
    expect(state().selection).toEqual([{ kind: 'room', id: room!.id }])

    state().updateRoom(room!.id, { name: 'Stue' })
    state().setRoomPolygon(room!.id, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ])
    expect(scenario().rooms[0]).toMatchObject({
      name: 'Stue',
      polygon: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ],
    })
  })

  it('detects the rooms of a closed set of walls', () => {
    box()
    expect(state().detectRooms()).toBe(1)
    expect(scenario().rooms).toHaveLength(1)
  })
})

describe('furniture', () => {
  it('places an item free, snapped to a wall, or a rug never snapped', () => {
    box()
    state().addFurniture('sofa-3', { x: 2, y: 1.5 }, { snap: false, rotation: 90 })
    state().addFurniture('sofa-3', { x: 2, y: 0.5 })
    state().addFurniture('teppe-200', { x: 2, y: 0.3 })
    const [free, snapped, rug] = scenario().furniture
    expect(free).toMatchObject({ x: 2, y: 1.5, rotation: 90 })
    expect(snapped!.y).not.toBe(0.5)
    expect(rug).toMatchObject({ x: 2, y: 0.3, rotation: 0 })
    expect(state().selection).toEqual([{ kind: 'furniture', id: rug!.id }])
  })

  it('moves an item with or without snapping, and turns it within a full circle', () => {
    box()
    state().addFurniture('sofa-3', { x: 2, y: 1.5 }, { snap: false })
    const id = scenario().furniture[0]!.id

    state().moveFurniture(id, { x: 1, y: 1 }, false)
    expect(scenario().furniture[0]).toMatchObject({ x: 1, y: 1 })
    state().moveFurniture(id, { x: 2, y: 0.5 }, true)
    expect(scenario().furniture[0]!.y).not.toBe(0.5)
    state().moveFurniture('f_gone', { x: 0, y: 0 }, false)

    state().rotateFurniture(id, -90)
    expect(scenario().furniture[0]!.rotation).toBe((scenario().furniture[0]!.rotation + 360) % 360)
    state().rotateFurniture('f_gone', 90)
  })

  it('adds finished items and the project’s own furniture types', () => {
    state().addFurnitureItems([
      { id: 'f_1', catalogId: 'sofa-2', x: 0, y: 0, rotation: 0, roomId: null, size: null, label: null },
    ])
    state().addCustomFurniture([
      { id: 'custom-hylle', name: 'Hylle', category: 'stue', w: 1, d: 0.3, h: 2, shape: 'cabinet', color: '#ccc' },
    ] as Project['customFurniture'])
    expect(scenario().furniture).toHaveLength(1)
    expect(project().customFurniture.map((c) => c.id)).toEqual(['custom-hylle'])
  })

  it('empties one room of furniture as one undo step, and lets go of what it removed', () => {
    const piece = (id: string, roomId: string | null) => ({
      id,
      catalogId: 'sofa-2',
      x: 0,
      y: 0,
      rotation: 0,
      roomId,
      size: null,
      label: null,
    })
    state().addFurnitureItems([piece('f_1', 'r_a'), piece('f_2', 'r_a'), piece('f_3', 'r_b'), piece('f_4', null)])
    state().setSelection([
      { kind: 'furniture', id: 'f_1' },
      { kind: 'furniture', id: 'f_3' },
    ])
    const before = steps()

    state().clearRoomFurniture('r_a')
    expect(scenario().furniture.map((f) => f.id)).toEqual(['f_3', 'f_4'])
    expect(state().selection).toEqual([{ kind: 'furniture', id: 'f_3' }])
    expect(steps()).toBe(before + 1)

    // A room with nothing in it: no change and no undo step
    state().clearRoomFurniture('r_a')
    expect(steps()).toBe(before + 1)

    useStore.temporal.getState().undo()
    expect(scenario().furniture).toHaveLength(4)
  })

  it('turns nothing when no furniture is selected, and duplicates nothing', () => {
    state().addFurniture('sofa-3', { x: 2, y: 1.5 }, { snap: false })
    state().select(null)
    const before = steps()
    state().rotateSelectedFurniture(90)
    state().duplicateSelected()
    state().deleteSelected()
    expect(steps()).toBe(before)
  })

  it('deletes selected installations, ceilings and rooms', () => {
    box()
    state().addFixture('outlet', { x: 1, y: 0.1 }, null)
    state().addRun([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
    state().addLoweredCeiling([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ])
    state().detectRooms()
    const s = scenario()
    state().setSelection([
      { kind: 'fixture', id: s.fixtures[0]!.id },
      { kind: 'run', id: s.runs[0]!.id },
      { kind: 'ceiling', id: s.loweredCeilings[0]!.id },
      { kind: 'room', id: s.rooms[0]!.id },
    ])

    state().deleteSelected()

    expect(scenario()).toMatchObject({ fixtures: [], runs: [], loweredCeilings: [], rooms: [] })
    expect(state().selection).toEqual([])
  })

  it('copies nothing without a project', () => {
    useStore.setState({ project: null })
    expect(state().copySelectedFurnitureTo('sc_x')).toBe(0)
  })
})

describe('calibration and suggestions', () => {
  it('rescales the drawing to a new image scale', () => {
    state().addWall({ x: 0, y: 0 }, { x: 4, y: 0 })
    state().calibrate(400, 2)
    expect(project().calibration).toEqual({ pxPerMeter: 200, calibrated: true })
    expect(scenario().walls[0]!.b.x).toBeCloseTo(2)
  })

  const suggestion = (scaleSource: DigitizeSuggestion['scaleSource']): DigitizeSuggestion => ({
    walls: [
      {
        id: 'w_s',
        a: { x: 0, y: 0 },
        b: { x: 3, y: 0 },
        thickness: 0.1,
        height: 2.4,
        loadBearing: 'unknown',
        exterior: false,
      },
    ],
    openings: [],
    rooms: [],
    pxPerMeter: 50,
    scaleSource,
    notes: '',
    warnings: [],
  })

  it('takes a suggestion into the active variant, rescaling the rest', () => {
    state().addFurniture('sofa-3', { x: 2, y: 2 }, { snap: false })
    state().setSuggestion(suggestion('dimensions'))

    state().acceptSuggestion()

    expect(scenario().walls.map((w) => w.id)).toEqual(['w_s'])
    expect(scenario().furniture[0]).toMatchObject({ x: 4, y: 4 })
    expect(project().calibration).toEqual({ pxPerMeter: 50, calibrated: true })
    expect(state().suggestion).toBeNull()
  })

  it('leaves the project uncalibrated for a suggestion without a scale', () => {
    state().setSuggestion(suggestion('none'))
    state().acceptSuggestion()
    expect(project().calibration.calibrated).toBe(false)
  })

  it('does nothing without a suggestion', () => {
    const before = project()
    state().acceptSuggestion()
    expect(project()).toBe(before)
  })
})

describe('the assistant', () => {
  it('stores the exchange, the new variants and the notes, and deletes a note', () => {
    const base = scenario().id
    const variant: Scenario = { ...emptyScenario(), name: 'Forslag' }
    const msg = (role: 'user' | 'assistant') => ({
      id: `m_${role}`,
      role,
      text: role,
      createdAt: '2026-01-01T00:00:00.000Z',
      roomId: null,
      scenarioIds: [],
    })

    state().applyAssistantResult({
      question: msg('user'),
      answer: msg('assistant'),
      scenarios: [variant],
      notes: [{ id: 'n_1', roomId: null, text: 'Flytt sofaen', author: 'ai', createdAt: '2026-01-01T00:00:00.000Z' }],
      baseScenarioId: base,
    })

    expect(project().chat.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(project().scenarios.map((s) => s.name)).toContain('Forslag')
    expect(scenario().notes.map((n) => n.id)).toEqual(['n_1'])

    state().deleteNote(base, 'n_1')
    expect(scenario().notes).toEqual([])
  })
})

describe('variants', () => {
  it('duplicates, renames and deletes variants, never the last one', () => {
    const first = scenario().id
    state().duplicateScenario('Kopi')
    const copy = scenario()
    expect(copy).toMatchObject({ name: 'Kopi', parentId: first })

    state().renameScenario(copy.id, 'Alternativ')
    expect(scenario().name).toBe('Alternativ')

    state().deleteScenario(copy.id)
    expect(project().activeScenarioId).toBe(first)
    state().deleteScenario(first)
    expect(project().scenarios).toHaveLength(1)
  })

  it('keeps the active variant when another one is deleted', () => {
    const first = scenario().id
    state().duplicateScenario('Kopi')
    const copy = scenario().id
    state().setActiveScenario(first)
    state().deleteScenario(copy)
    expect(project().activeScenarioId).toBe(first)
  })
})
