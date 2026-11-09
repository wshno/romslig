import { describe, expect, it } from 'vitest'
import { emptyScenario, redetectRooms, v, type Project, type Scenario, type Wall } from '@romslig/shared'
import { buildTools } from './tools.ts'
import { Workspace } from './workspace.ts'

const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<Wall> = {}): Wall => ({
  id,
  a: v(ax, ay),
  b: v(bx, by),
  thickness: 0.1,
  height: 2.4,
  loadBearing: 'no',
  exterior: false,
  ...extra,
})

/** 6 × 4 m apartment: living room (left, 4 m) and bathroom (right, 2 m) split by wall "mid". */
function project(): Project {
  const base: Scenario = redetectRooms({
    ...emptyScenario(),
    walls: [
      wall('top', 0, 0, 6, 0, { exterior: true, loadBearing: 'yes', thickness: 0.25 }),
      wall('right', 6, 0, 6, 4, { exterior: true, loadBearing: 'yes', thickness: 0.25 }),
      wall('bottom', 6, 4, 0, 4, { exterior: true, loadBearing: 'yes', thickness: 0.25 }),
      wall('left', 0, 4, 0, 0, { exterior: true, loadBearing: 'yes', thickness: 0.25 }),
      wall('mid', 4, 0, 4, 4, { loadBearing: 'unknown' }),
    ],
  })
  const rooms = base.rooms.map((r) =>
    r.polygon.some((p) => p.x > 5)
      ? { ...r, name: 'Bad', type: 'bad' as const }
      : { ...r, name: 'Stue', type: 'stue' as const },
  )
  const s = { ...base, rooms }
  return {
    id: 'p_t',
    name: 'Test',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: true },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [s],
    activeScenarioId: s.id,
    chat: [],
    createdAt: '',
    updatedAt: '',
  }
}

function setup() {
  const p = project()
  const ws = new Workspace(p)
  const activity: string[] = []
  const tools = Object.fromEntries(buildTools(ws, (t) => activity.push(t)).map((t) => [t.name, t]))
  const call = async (name: string, input: unknown) => JSON.parse((await tools[name]!.run(input as never)) as string)
  return { p, ws, call, activity }
}

describe('assistant tools', () => {
  it('describes walls with the rooms they separate', () => {
    const { ws } = setup()
    const d = ws.describe(ws.base)
    expect(d.rooms.map((r) => r.name).sort()).toEqual(['Bad', 'Stue'])
    expect(d.walls.find((w) => w.id === 'mid')!.between_rooms).toHaveLength(2)
  })

  it("refuses to edit the user's own variant", async () => {
    const { p, call } = setup()
    await expect(
      call('auto_place_furniture', { scenario_id: p.activeScenarioId, room_id: 'x', catalog_ids: ['sofa-3'] }),
    ).rejects.toThrow(/not editable/)
  })

  it('creates a variant and furnishes a room without problems', async () => {
    const { ws, call, activity } = setup()
    const { scenario_id } = await call('create_variant', { name: 'Møblert stue', base_scenario_id: null })
    const stue = ws.get(scenario_id).rooms.find((r) => r.name === 'Stue')!
    const res = await call('auto_place_furniture', {
      scenario_id,
      room_id: stue.id,
      catalog_ids: ['sofa-3', 'salongbord', 'tv-benk', 'lenestol'],
    })
    expect(res.placed).toHaveLength(4)
    const view = await call('view_variant', { scenario_id })
    expect(view.problems).toEqual([])
    expect(view.scenario.editable).toBe(true)
    expect(activity).toContain('Lager variant «Møblert stue»')
    // the user's variant is untouched
    expect(ws.base.furniture).toHaveLength(0)
  })

  it('warns about unknown load-bearing status and wet rooms when removing a wall, and merges rooms', async () => {
    const { ws, call } = setup()
    const { scenario_id } = await call('create_variant', { name: 'Uten skillevegg', base_scenario_id: null })
    const res = await call('modify_walls', { scenario_id, changes: [{ action: 'remove_wall', wall_id: 'mid' }] })
    expect(res.warnings.join(' ')).toMatch(/RIB/)
    expect(res.warnings.join(' ')).toMatch(/våtrom/i)
    expect(res.rooms_after).toHaveLength(1)
    expect(ws.get(scenario_id).walls).toHaveLength(4)
  })

  it('flags new windows in exterior walls', async () => {
    const { call } = setup()
    const { scenario_id } = await call('create_variant', { name: 'Nytt vindu', base_scenario_id: null })
    const res = await call('modify_walls', {
      scenario_id,
      changes: [{ action: 'add_opening', wall_id: 'top', kind: 'window', center_offset: 2, width: 1.2 }],
    })
    expect(res.warnings.join(' ')).toMatch(/bærende/)
    expect(res.warnings.join(' ')).toMatch(/yttervegg/)
  })

  it('rejects unknown catalog ids with a helpful message', async () => {
    const { call } = setup()
    const { scenario_id } = await call('create_variant', { name: 'X', base_scenario_id: null })
    await expect(
      call('place_furniture', {
        scenario_id,
        items: [{ catalog_id: 'flygel', x: 1, y: 1, rotation: 0, label: null, size_cm: null }],
      }),
    ).rejects.toThrow(/Unknown catalog_id/)
  })

  it('keeps notes for the current variant separate from draft notes', async () => {
    const { ws, call } = setup()
    const { scenario_id } = await call('create_variant', { name: 'X', base_scenario_id: null })
    await call('add_note', { scenario_id: null, room_id: null, text: 'Lyse farger' })
    await call('add_note', { scenario_id, room_id: null, text: 'Eik' })
    expect(ws.baseNotes.map((n) => n.text)).toEqual(['Lyse farger'])
    expect(ws.get(scenario_id).notes.map((n) => n.text)).toEqual(['Eik'])
  })
})

describe('assistant tools and installations', () => {
  it('warns that a removed wall carries an outlet and a drain', async () => {
    const p = project()
    const s = p.scenarios[0]!
    p.scenarios[0] = {
      ...s,
      fixtures: [{ id: 'o', kind: 'outlet_double', x: 3.95, y: 2, z: 0.3, wallId: 'mid', label: null, note: null }],
      runs: [
        {
          id: 'd',
          kind: 'drain',
          placement: 'wall',
          points: [v(4, 0.5), v(4, 3.5)],
          z: 0.1,
          diameter: 0.11,
          label: null,
          note: null,
        },
      ],
    }
    const ws = new Workspace(p)
    const tools = Object.fromEntries(buildTools(ws, () => {}).map((t) => [t.name, t]))
    const call = async (name: string, input: unknown) => JSON.parse((await tools[name]!.run(input as never)) as string)
    const { scenario_id } = await call('create_variant', { name: 'X', base_scenario_id: null })
    const res = await call('modify_walls', { scenario_id, changes: [{ action: 'remove_wall', wall_id: 'mid' }] })
    const text = res.warnings.join(' ')
    expect(text).toMatch(/dobbel stikkontakt/)
    expect(text).toMatch(/avløp/)
    expect(text).toMatch(/elektriker.*rørlegger|rørlegger.*elektriker/)
    const view = await call('view_variant', { scenario_id: p.activeScenarioId })
    expect(view.installations.fixtures[0].name).toBe('Dobbel stikkontakt')
  })
})
