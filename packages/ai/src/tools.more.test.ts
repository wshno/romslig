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

/** 6 × 4 m apartment: living room (left, 4 m) and bathroom (right, 2 m) split by wall "mid", with a door in it. */
function project(): Project {
  const base: Scenario = redetectRooms({
    ...emptyScenario(),
    walls: [
      wall('top', 0, 0, 6, 0, { exterior: true, loadBearing: 'yes', thickness: 0.25 }),
      wall('right', 6, 0, 6, 4, { exterior: true, loadBearing: 'yes', thickness: 0.25 }),
      wall('bottom', 6, 4, 0, 4, { exterior: true, loadBearing: 'yes', thickness: 0.25 }),
      wall('left', 0, 4, 0, 0, { exterior: true, loadBearing: 'yes', thickness: 0.25 }),
      wall('mid', 4, 0, 4, 4),
    ],
    openings: [
      { id: 'door', wallId: 'mid', kind: 'door', offset: 1, width: 0.8, height: 2.1, sill: 0, flip: false },
      { id: 'orphan', wallId: 'gone', kind: 'window', offset: 0, width: 1, height: 1, sill: 1, flip: false },
    ],
  })
  const rooms = base.rooms.map((r) =>
    r.polygon.some((p) => p.x > 5)
      ? { ...r, name: 'Bad', type: 'bad' as const }
      : { ...r, name: 'Stue', type: 'stue' as const },
  )
  const s: Scenario = {
    ...base,
    rooms,
    loweredCeilings: [{ id: 'lc', polygon: [v(4, 0), v(6, 0), v(6, 4)], height: 2.2, label: 'Bad' }],
  }
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
    customFurniture: [],
    version: 0,
    createdAt: '',
    updatedAt: '',
  }
}

async function setup() {
  const p = project()
  const ws = new Workspace(p)
  const activity: string[] = []
  const tools = Object.fromEntries(buildTools(ws, (t) => activity.push(t)).map((t) => [t.name, t]))
  const call = async (name: string, input: unknown) => JSON.parse((await tools[name]!.run(input as never)) as string)
  const { scenario_id } = (await call('create_variant', { name: 'Utkast', base_scenario_id: null })) as {
    scenario_id: string
  }
  const room = (name: string) => ws.get(scenario_id).rooms.find((r) => r.name === name)!
  return { p, ws, call, activity, scenario_id, room }
}

describe('placing furniture', () => {
  it('places items with their size and label, in the room they stand in', async () => {
    const { ws, call, scenario_id, room, activity } = await setup()
    const res = await call('place_furniture', {
      scenario_id,
      items: [
        { catalog_id: 'sofa-3', x: 2, y: 2, rotation: -90, label: 'Gammel sofa', size_cm: { w: 200, d: 90, h: 80 } },
      ],
    })

    const [item] = ws.get(scenario_id).furniture
    expect(res.added).toEqual([{ id: item!.id, catalog_id: 'sofa-3' }])
    expect(item).toMatchObject({ rotation: 270, label: 'Gammel sofa', size: { w: 2, d: 0.9, h: 0.8 } })
    expect(item!.roomId).toBe(room('Stue').id)
    expect(activity).toContain('Plasserer 1 møbel')
  })

  it('reports the problems of items that overlap', async () => {
    const { call, scenario_id } = await setup()
    const item = { catalog_id: 'sofa-3', x: 2, y: 2, rotation: 0, label: null, size_cm: null }
    const res = await call('place_furniture', { scenario_id, items: [item, item] })
    expect(res.problems.length).toBeGreaterThan(0)
  })

  it('lists what did not fit when furnishing a room', async () => {
    const { call, scenario_id, room } = await setup()
    const res = await call('auto_place_furniture', {
      scenario_id,
      room_id: room('Bad').id,
      catalog_ids: Array.from({ length: 12 }, () => 'sofa-4'),
    })
    expect(res.not_placed.length).toBeGreaterThan(0)
  })

  it('refuses an unknown room or catalog id', async () => {
    const { call, scenario_id, room } = await setup()
    await expect(
      call('auto_place_furniture', { scenario_id, room_id: 'r_x', catalog_ids: ['sofa-3'] }),
    ).rejects.toThrow(/Unknown room_id/)
    await expect(
      call('auto_place_furniture', { scenario_id, room_id: room('Stue').id, catalog_ids: ['flygel'] }),
    ).rejects.toThrow(/Unknown catalog_id/)
  })
})

describe('updating furniture', () => {
  it('moves, turns and removes items, and keeps the rest where they were', async () => {
    const { ws, call, scenario_id, room, activity } = await setup()
    await call('place_furniture', {
      scenario_id,
      items: [
        { catalog_id: 'lenestol', x: 1, y: 1, rotation: 0, label: null, size_cm: null },
        { catalog_id: 'salongbord', x: 2, y: 3, rotation: 0, label: null, size_cm: null },
      ],
    })
    const [chair, table] = ws.get(scenario_id).furniture

    const res = await call('update_furniture', {
      scenario_id,
      changes: [
        { furniture_id: chair!.id, x: 5, y: null, rotation: 45, remove: false },
        { furniture_id: table!.id, x: null, y: null, rotation: null, remove: true },
      ],
    })

    expect(res.problems).toEqual(expect.any(Array))
    const after = ws.get(scenario_id).furniture
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ x: 5, y: 1, rotation: 45, roomId: room('Bad').id })
    expect(activity).toContain('Justerer 2 møbler')
  })

  it('refuses an unknown furniture id', async () => {
    const { call, scenario_id } = await setup()
    await expect(
      call('update_furniture', {
        scenario_id,
        changes: [{ furniture_id: 'f_x', x: 1, y: 1, rotation: null, remove: false }],
      }),
    ).rejects.toThrow(/Unknown furniture_id/)
  })
})

describe('changing walls', () => {
  it('adds and moves walls and changes openings', async () => {
    const { ws, call, scenario_id, activity } = await setup()
    const res = await call('modify_walls', {
      scenario_id,
      changes: [
        { action: 'add_wall', x1: 0, y1: 2, x2: 4, y2: 2, thickness: 0.1 },
        { action: 'move_wall', wall_id: 'mid', x1: 3.5, y1: 0, x2: 3.5, y2: 4 },
        { action: 'resize_opening', opening_id: 'door', width: 0.9 },
        { action: 'add_opening', wall_id: 'mid', kind: 'door', center_offset: 3, width: 0.8 },
        { action: 'remove_opening', opening_id: 'orphan' },
      ],
    })

    const s = ws.get(scenario_id)
    expect(s.walls).toHaveLength(6)
    expect(s.walls.find((w) => w.id === 'mid')!.a.x).toBe(3.5)
    expect(s.openings.find((o) => o.id === 'door')!.width).toBeCloseTo(0.9)
    expect(s.openings.filter((o) => o.kind === 'door')).toHaveLength(2)
    expect(res.rooms_after.length).toBeGreaterThanOrEqual(2)
    expect(res.warnings.join(' ')).toMatch(/våtrom/i)
    expect(activity).toContain('Endrer vegger i «Utkast» (5 endringer)')
  })

  it('needs no warning for a door in a wall known not to carry', async () => {
    const { call, scenario_id } = await setup()
    await call('modify_walls', {
      scenario_id,
      changes: [{ action: 'add_wall', x1: 0, y1: 2, x2: 4, y2: 2, thickness: 0.1 }],
    })
    const res = await call('modify_walls', {
      scenario_id,
      changes: [{ action: 'add_opening', wall_id: 'mid', kind: 'door', center_offset: 0.5, width: 0.7 }],
    })
    expect(res.warnings.join(' ')).not.toMatch(/bærende/)
  })

  it('flags a new door in a load-bearing wall', async () => {
    const { call, scenario_id } = await setup()
    const res = await call('modify_walls', {
      scenario_id,
      changes: [{ action: 'add_opening', wall_id: 'top', kind: 'door', center_offset: 2, width: 0.9 }],
    })
    expect(res.warnings.join(' ')).toMatch(/bærende/)
  })

  it('refuses unknown walls and openings, and an opening wider than its wall', async () => {
    const { call, scenario_id } = await setup()
    const one = (change: unknown) => call('modify_walls', { scenario_id, changes: [change] })
    await expect(one({ action: 'remove_wall', wall_id: 'w_x' })).rejects.toThrow(/Unknown wall_id/)
    await expect(one({ action: 'remove_opening', opening_id: 'o_x' })).rejects.toThrow(/Unknown opening_id/)
    await expect(one({ action: 'resize_opening', opening_id: 'o_x', width: 1 })).rejects.toThrow(/Unknown opening_id/)
    await expect(
      one({ action: 'add_opening', wall_id: 'mid', kind: 'opening', center_offset: 2, width: 9 }),
    ).rejects.toThrow(/wider than wall/)
  })
})

describe('the workspace', () => {
  it('describes openings with the rooms they connect, skipping those without a wall, and lowered ceilings', async () => {
    const { ws, scenario_id } = await setup()
    const d = ws.describe(ws.get(scenario_id))
    expect(d.openings.map((o) => o.id)).toEqual(['door'])
    expect(d.openings[0]!.connects_rooms).toHaveLength(2)
    const [ceiling] = d.installations.lowered_ceilings
    expect(ceiling).toMatchObject({ id: 'lc', height: 2.2, label: 'Bad' })
    expect(ceiling!.polygon).toHaveLength(3)
  })

  it('bases a variant on another one, and refuses an unknown one', async () => {
    const { ws, scenario_id } = await setup()
    const child = ws.createVariant('Barn', scenario_id)
    expect(child.parentId).toBe(scenario_id)
    expect(() => ws.get('sc_x')).toThrow(/Unknown scenario_id/)
  })

  it('names rooms, and nothing for an unknown room', async () => {
    const { ws, scenario_id, room } = await setup()
    const s = ws.get(scenario_id)
    expect(ws.roomName(s, room('Bad').id)).toBe('Bad')
    expect(ws.roomName(s, null)).toBeNull()
  })

  it('uses the first variant when the active one is missing', () => {
    const p = project()
    const ws = new Workspace({ ...p, activeScenarioId: 'sc_missing' })
    expect(ws.base.id).toBe(p.scenarios[0]!.id)
  })
})
