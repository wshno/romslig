import { describe, expect, it } from 'vitest'
import { compareScenarios } from './compare.ts'
import { v } from './geometry.ts'
import { emptyScenario, type Scenario, type Wall } from './model.ts'
import { redetectRooms } from './scenario.ts'

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

function base(): Scenario {
  const s = redetectRooms({
    ...emptyScenario(),
    walls: [
      wall('t', 0, 0, 6, 0),
      wall('r', 6, 0, 6, 3),
      wall('b', 6, 3, 0, 3),
      wall('l', 0, 3, 0, 0),
      wall('m', 3, 0, 3, 3, { loadBearing: 'unknown' }),
    ],
  })
  return {
    ...s,
    rooms: s.rooms.map((r) =>
      r.polygon.some((p) => p.x > 4)
        ? { ...r, name: 'Bad', type: 'bad' as const }
        : { ...r, name: 'Stue', type: 'stue' as const },
    ),
    furniture: [
      { id: 'f1', catalogId: 'sofa-3', x: 1.5, y: 1, rotation: 0, roomId: null, size: null, label: 'Min sofa' },
    ],
  }
}

describe('compareScenarios', () => {
  it('reports nothing for identical variants', () => {
    const a = base()
    const c = compareScenarios(a, structuredClone(a))
    expect(c.walls.removed).toHaveLength(0)
    expect(c.rooms).toHaveLength(0)
    expect(c.flags).toHaveLength(0)
  })

  it('reports a removed wall, merged rooms, flags and furniture changes', () => {
    const a = base()
    const b0 = redetectRooms({ ...structuredClone(a), walls: a.walls.filter((w) => w.id !== 'm') })
    const b = {
      ...b0,
      furniture: [
        { ...a.furniture[0]!, x: 2 },
        { id: 'f2', catalogId: 'lenestol', x: 4, y: 1, rotation: 0, roomId: null, size: null, label: null },
      ],
    }
    const c = compareScenarios(a, b)
    expect(c.walls.removed.map((w) => w.id)).toEqual(['m'])
    expect(c.rooms.some((r) => r.after === null)).toBe(true) // one room merged away
    expect(c.rooms.find((r) => r.after !== null)!.after!).toBeGreaterThan(
      c.rooms.find((r) => r.after !== null)!.before!,
    )
    expect(c.flags.join(' ')).toMatch(/RIB/)
    expect(c.flags.join(' ')).toMatch(/Våtrom/)
    expect(c.furniture).toMatchObject({ added: ['Lenestol'], removed: [], moved: ['Min sofa'] })
  })
})

describe('furniture changes per room', () => {
  const item = (id: string, catalogId: string, x: number, y = 1) => ({
    id,
    catalogId,
    x,
    y,
    rotation: 0,
    roomId: null,
    size: null,
    label: null,
  })
  const roomId = (s: Scenario, name: string) => s.rooms.find((r) => r.name === name)!.id

  it('is empty when no furniture changed', () => {
    const a = base()
    expect(compareScenarios(a, structuredClone(a)).furniture.byRoom).toEqual([])
  })

  it('groups by room and counts items of the same name', () => {
    const a = { ...base(), furniture: [item('old', 'lenestol', 1), item('gone', 'lenestol', 5)] }
    const b = {
      ...structuredClone(a),
      furniture: [
        item('old', 'lenestol', 1),
        item('n1', 'nattbord', 0.5),
        item('n2', 'nattbord', 2.5),
        item('n3', 'sofa-3', 1.5, 2),
      ],
    }
    expect(compareScenarios(a, b).furniture.byRoom).toEqual([
      {
        roomId: roomId(a, 'Stue'),
        room: 'Stue',
        added: [
          { name: 'Nattbord', count: 2 },
          { name: 'Sofa, 3-seter', count: 1 },
        ],
        removed: [],
        moved: [],
      },
      { roomId: roomId(a, 'Bad'), room: 'Bad', added: [], removed: [{ name: 'Lenestol', count: 1 }], moved: [] },
    ])
  })

  it('says where an item came from when it changed room, and puts items outside every room last', () => {
    const a = { ...base(), furniture: [item('s', 'lenestol', 1), item('t', 'lenestol', 2), item('u', 'nattbord', 5)] }
    const b = {
      ...structuredClone(a),
      furniture: [item('s', 'lenestol', 5), item('t', 'lenestol', 2, 2), item('u', 'nattbord', 9)],
    }
    expect(compareScenarios(a, b).furniture.byRoom).toEqual([
      { roomId: roomId(a, 'Stue'), room: 'Stue', added: [], removed: [], moved: [{ name: 'Lenestol', count: 1 }] },
      {
        roomId: roomId(a, 'Bad'),
        room: 'Bad',
        added: [],
        removed: [],
        moved: [{ name: 'Lenestol', count: 1, from: 'Stue' }],
      },
      { roomId: null, room: null, added: [], removed: [], moved: [{ name: 'Nattbord', count: 1, from: 'Bad' }] },
    ])
  })

  it('files a removed item under the room that took over when its room is gone', () => {
    const a = { ...base(), furniture: [item('x', 'lenestol', 5)] }
    const b = { ...redetectRooms({ ...structuredClone(a), walls: a.walls.filter((w) => w.id !== 'm') }), furniture: [] }
    const [group] = compareScenarios(a, b).furniture.byRoom
    expect(group!.removed).toEqual([{ name: 'Lenestol', count: 1 }])
    expect(a.rooms.map((r) => r.name)).toContain(group!.room)
  })
})

describe('compareScenarios with installations', () => {
  it('flags removing a wall that has an outlet and a water pipe', () => {
    const a: Scenario = {
      ...base(),
      fixtures: [{ id: 'o1', kind: 'outlet', x: 3.05, y: 1, z: 0.3, wallId: 'm', label: null, note: null }],
      runs: [
        {
          id: 'p1',
          kind: 'water_cold',
          placement: 'wall',
          points: [v(3, 0.2), v(3, 2.5)],
          z: 0.3,
          diameter: 0.02,
          label: null,
          note: null,
        },
      ],
    }
    const b = redetectRooms({ ...structuredClone(a), walls: a.walls.filter((w) => w.id !== 'm') })
    const c = compareScenarios(a, b)
    const text = c.flags.join(' ')
    expect(text).toMatch(/stikkontakt/)
    expect(text).toMatch(/kaldtvann/)
    expect(text).toMatch(/elektriker/)
    expect(text).toMatch(/rørlegger/)
    expect(c.installations).toEqual({ added: 0, removed: 0, moved: 0 })
  })
})
