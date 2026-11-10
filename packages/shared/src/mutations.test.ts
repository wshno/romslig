import { describe, expect, it } from 'vitest'
import { closestPointOnSegment, polygonArea, v } from './geometry.ts'
import { emptyScenario, type FurnitureItem, type Note, type Room, type Scenario, type Wall } from './model.ts'
import type { Fixture } from './installations.ts'
import {
  boundingWalls,
  fitRoomToWalls,
  moveWallEndpoint,
  removeRoom,
  removeWall,
  replaceGeometry,
  rescaleScenario,
  wallsMovedWith,
} from './mutations.ts'
import { redetectRooms } from './scenario.ts'

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id,
  a: v(ax, ay),
  b: v(bx, by),
  thickness: 0.1,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
})

/**
 * 6 × 3 m, split by the wall `m` at x = 4 that stands against `t` and `b` (T-junctions):
 * Stue to the left, Bad to the right.
 *
 *   (0,0) ────────t────────┬──── (6,0)
 *     l        Stue        m  Bad  r
 *   (0,3) ────────b────────┴──── (6,3)
 */
function flat(): Scenario {
  const s = redetectRooms({
    ...emptyScenario(),
    walls: [
      wall('t', 0, 0, 6, 0),
      wall('r', 6, 0, 6, 3),
      wall('b', 6, 3, 0, 3),
      wall('l', 0, 3, 0, 0),
      wall('m', 4, 0, 4, 3),
    ],
  })
  return { ...s, rooms: s.rooms.map((r) => ({ ...r, name: polygonArea(r.polygon) > 8 ? 'Stue' : 'Bad' })) }
}

const wallOf = (s: Scenario, id: string) => s.walls.find((w) => w.id === id)!
const roomOf = (s: Scenario, name: string) => s.rooms.find((r) => r.name === name)!
const area = (s: Scenario, name: string) => polygonArea(roomOf(s, name).polygon)

const chair = (x: number, y: number, roomId: string | null): FurnitureItem => ({
  id: 'f',
  catalogId: 'kommode',
  x,
  y,
  rotation: 0,
  roomId,
  size: null,
  label: null,
})
const socket = (x: number, y: number, wallId: string | null): Fixture => ({
  id: 'x',
  kind: 'outlet',
  x,
  y,
  z: 0.3,
  wallId,
  label: null,
  note: null,
})
const note = (roomId: string | null): Note => ({
  id: 'n',
  roomId,
  text: 'Flis',
  author: 'user',
  createdAt: '2026-01-01T00:00:00Z',
})
const zone = (id: string, name: string, x: number, y: number): Room => ({
  id,
  name,
  type: 'annet',
  polygon: [v(x, y), v(x + 1, y), v(x + 1, y + 1), v(x, y + 1)],
  statedArea: null,
})

describe('moveWallEndpoint', () => {
  it('takes the walls in the same corner along', () => {
    const s = moveWallEndpoint(flat(), 't', 'b', v(7, 0))
    expect(wallOf(s, 't').b).toEqual(v(7, 0))
    expect(wallOf(s, 'r').a).toEqual(v(7, 0))
    expect(wallOf(s, 'r').b).toEqual(v(6, 3))
  })

  it('leaves a wall standing against the side where it was when an end is dragged along the wall', () => {
    const right = moveWallEndpoint(flat(), 't', 'b', v(7, 0))
    expect(wallOf(right, 'm').a).toEqual(v(4, 0))
    // Dragging the end the distance was measured from must not push the wall along either
    const left = moveWallEndpoint(flat(), 't', 'a', v(-1, 0))
    expect(wallOf(left, 'm').a.x).toBeCloseTo(4)
    expect(wallOf(left, 'l').b).toEqual(v(-1, 0))
  })

  it('lengthens a wall standing against the side, in its own direction, when the host is tilted', () => {
    const s = moveWallEndpoint(flat(), 't', 'b', v(6, -1.5))
    const t = wallOf(s, 't')
    expect(closestPointOnSegment(wallOf(s, 'm').a, t.a, t.b).dist).toBeLessThan(1e-9)
    // Still vertical: it meets t where x = 4
    expect(wallOf(s, 'm').a.x).toBeCloseTo(4)
    expect(wallOf(s, 'm').a.y).toBeCloseTo(-1)
    expect(wallOf(s, 'm').b).toEqual(v(4, 3))
  })

  it('ends a wall standing against the side at the end of the host when the host is pulled away from it', () => {
    const s = moveWallEndpoint(flat(), 't', 'b', v(3, 0))
    expect(wallOf(s, 'm').a).toEqual(v(3, 0))
    expect(wallOf(s, 'm').b).toEqual(v(4, 3))
  })

  it('follows through several walls: a wall against a wall against the dragged one', () => {
    const base = flat()
    const withN = { ...base, walls: [...base.walls, wall('n', 2, 1.5, 4, 1.5)] }
    expect(wallsMovedWith(withN, 't', 'b').sort()).toEqual(['m', 'n', 'r', 't'])
    // t is shortened past m, so m leans, and n reaches further to keep touching it
    const s = moveWallEndpoint(withN, 't', 'b', v(3, 0))
    const m = wallOf(s, 'm')
    const n = wallOf(s, 'n')
    expect(m.a).toEqual(v(3, 0))
    expect(closestPointOnSegment(n.b, m.a, m.b).dist).toBeLessThan(1e-9)
    expect(n.b.x).toBeCloseTo(3.5)
    expect(n.b.y).toBeCloseTo(1.5)
    expect(n.a).toEqual(v(2, 1.5))
  })

  it('keeps a door in a wall that is lengthened at the same distance from the end that stands still', () => {
    const base: Scenario = {
      ...flat(),
      openings: [{ id: 'o', wallId: 'm', kind: 'door', offset: 1.5, width: 0.8, height: 2.1, sill: 0, flip: false }],
    }
    // m.a goes from (4,0) to (4,-1): the door is still 1.5 m from m.b
    const s = moveWallEndpoint(base, 't', 'b', v(6, -1.5))
    expect(s.openings[0]!.offset).toBeCloseTo(2.5)
  })

  it('keeps openings where they were, measured from the end that stands still', () => {
    const base: Scenario = {
      ...flat(),
      openings: [{ id: 'o', wallId: 't', kind: 'window', offset: 5, width: 0.8, height: 1.2, sill: 0.9, flip: false }],
    }
    expect(moveWallEndpoint(base, 't', 'b', v(7, 0)).openings[0]!.offset).toBe(5)
    // a moved 1 m to the left: the window is still at x = 5
    expect(moveWallEndpoint(base, 't', 'a', v(-1, 0)).openings[0]!.offset).toBeCloseTo(6)
  })

  it('keeps wall-mounted fixtures on their wall', () => {
    const base: Scenario = { ...flat(), fixtures: [socket(2, 0.05, 't')] }
    const moved = moveWallEndpoint(base, 't', 'a', v(-1, 0)).fixtures[0]!
    expect(moved.x).toBeCloseTo(2)
    expect(moved.y).toBeCloseTo(0.05)
    const tilted = moveWallEndpoint(base, 't', 'b', v(6, -1))
    const t = wallOf(tilted, 't')
    expect(closestPointOnSegment(tilted.fixtures[0]!, t.a, t.b).dist).toBeCloseTo(0.05)
  })

  it('lets rooms follow their walls and keep their names', () => {
    const base = flat()
    const s = moveWallEndpoint(moveWallEndpoint(base, 't', 'b', v(7, 0)), 'b', 'a', v(7, 3))
    expect(s.rooms.map((r) => r.name).sort()).toEqual(['Bad', 'Stue'])
    expect(roomOf(s, 'Bad').id).toBe(roomOf(base, 'Bad').id)
    expect(area(s, 'Bad')).toBeCloseTo(area(base, 'Bad') + 2.9, 2)
    expect(area(s, 'Stue')).toBeCloseTo(area(base, 'Stue'), 5)
  })

  it('moves the dividing wall and both rooms with it', () => {
    const base = flat()
    const s = moveWallEndpoint(moveWallEndpoint(base, 'm', 'a', v(3, 0)), 'm', 'b', v(3, 3))
    expect(area(s, 'Stue')).toBeCloseTo(area(base, 'Stue') - 2.9, 2)
    expect(area(s, 'Bad')).toBeCloseTo(area(base, 'Bad') + 2.9, 2)
  })

  it('re-assigns furniture to the room it stands in afterwards', () => {
    const base = flat()
    const furnished: Scenario = { ...base, furniture: [chair(3.5, 1.5, roomOf(base, 'Stue').id)] }
    const s = moveWallEndpoint(moveWallEndpoint(furnished, 'm', 'a', v(3, 0)), 'm', 'b', v(3, 3))
    expect(s.furniture[0]!.roomId).toBe(roomOf(s, 'Bad').id)
  })

  it('leaves a zone drawn across an open room alone', () => {
    const base = flat()
    const z = zone('z', 'Spiseplass', 1, 1)
    const s = moveWallEndpoint({ ...base, rooms: [...base.rooms, z] }, 't', 'b', v(7, 0))
    expect(s.rooms.find((r) => r.id === 'z')).toEqual(z)
  })

  it('keeps a room as it was while its walls do not enclose it', () => {
    const base = flat()
    // r no longer reaches the corner, so Bad is open at the top right
    const open = { ...base, walls: base.walls.map((w) => (w.id === 'r' ? { ...w, a: v(6, 1) } : w)) }
    const s = moveWallEndpoint(open, 't', 'b', v(7, 0))
    expect(roomOf(s, 'Bad').polygon).toEqual(roomOf(base, 'Bad').polygon)
    expect(s.rooms).toHaveLength(2)
  })

  it('returns the scenario untouched for a wall that does not exist', () => {
    const base = flat()
    expect(moveWallEndpoint(base, 'missing', 'a', v(1, 1))).toBe(base)
  })
})

describe('removeWall', () => {
  const furnished = (): Scenario => {
    const base = flat()
    const bad = roomOf(base, 'Bad').id
    return {
      ...base,
      openings: [{ id: 'o', wallId: 'm', kind: 'door', offset: 1.5, width: 0.8, height: 2.1, sill: 0, flip: false }],
      furniture: [chair(5, 1.5, bad)],
      fixtures: [socket(4.05, 1, 'm')],
      notes: [note(bad)],
    }
  }

  it('merges the two rooms into the larger one and leaves nothing pointing at what is gone', () => {
    const s = removeWall(furnished(), 'm')
    expect(s.walls.map((w) => w.id)).not.toContain('m')
    expect(s.openings).toEqual([])
    expect(s.rooms.map((r) => r.name)).toEqual(['Stue'])
    expect(area(s, 'Stue')).toBeCloseTo(5.9 * 2.9, 1)
    expect(s.furniture[0]!.roomId).toBe(roomOf(s, 'Stue').id)
    expect(s.fixtures[0]).toMatchObject({ x: 4.05, y: 1, wallId: null })
    expect(s.notes[0]!.roomId).toBeNull()
  })

  it('keeps the room when an outer wall goes: it is just no longer enclosed', () => {
    const base = furnished()
    const s = removeWall(base, 'r')
    expect(s.rooms.map((r) => r.name).sort()).toEqual(['Bad', 'Stue'])
    expect(roomOf(s, 'Bad').polygon).toEqual(roomOf(base, 'Bad').polygon)
    expect(s.openings).toHaveLength(1)
  })
})

describe('removeRoom', () => {
  it('detaches furniture and notes from the room', () => {
    const base = flat()
    const bad = roomOf(base, 'Bad').id
    const s = removeRoom({ ...base, furniture: [chair(5, 1.5, bad)], notes: [note(bad)] }, bad)
    expect(s.rooms.map((r) => r.name)).toEqual(['Stue'])
    expect(s.furniture[0]!.roomId).toBeNull()
    expect(s.notes[0]!.roomId).toBeNull()
  })
})

describe('rescaleScenario', () => {
  it('scales every position, and the traced opening widths, but no real measures', () => {
    const base = flat()
    const s = rescaleScenario(
      {
        ...base,
        openings: [{ id: 'o', wallId: 't', kind: 'door', offset: 1, width: 0.8, height: 2.1, sill: 0, flip: false }],
        furniture: [chair(1, 2, null)],
        fixtures: [socket(2, 0.05, 't')],
        loweredCeilings: [{ id: 'c', polygon: [v(0, 0), v(1, 0), v(1, 1)], height: 2.2, label: null }],
      },
      2,
    )
    expect(wallOf(s, 't')).toMatchObject({ b: v(12, 0), thickness: 0.1, height: 2.4 })
    expect(s.openings[0]).toMatchObject({ offset: 2, width: 1.6, height: 2.1 })
    expect(area(s, 'Stue')).toBeCloseTo(area(base, 'Stue') * 4)
    expect(s.furniture[0]).toMatchObject({ x: 2, y: 4 })
    expect(s.fixtures[0]).toMatchObject({ x: 4, y: 0.1, z: 0.3 })
    expect(s.loweredCeilings[0]).toMatchObject({ polygon: [v(0, 0), v(2, 0), v(2, 2)], height: 2.2 })
    expect(rescaleScenario(base, 1)).toBe(base)
  })
})

describe('fitRoomToWalls', () => {
  it('measures a room traced along the wall centre lines to the inside of the walls', () => {
    const traced = [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]
    expect(polygonArea(fitRoomToWalls(traced, flat().walls))).toBeCloseTo(3.9 * 2.9, 2)
  })

  it('returns any other outline as drawn', () => {
    const walls = flat().walls
    const free = zone('z', 'Spiseplass', 1, 1).polygon
    expect(fitRoomToWalls(free, walls)).toBe(free)
    // Along walls on three sides, but covering only half of the enclosed area
    const half = [v(0, 0), v(2, 0), v(2, 3), v(0, 3)]
    expect(fitRoomToWalls(half, walls)).toBe(half)
  })
})

describe('boundingWalls', () => {
  it('names the walls around a detected room, and null for an outline that leaves the walls', () => {
    const base = flat()
    expect(boundingWalls(roomOf(base, 'Bad').polygon, base.walls)?.sort()).toEqual(['b', 'm', 'r', 't'])
    expect(boundingWalls(zone('z', 'Spiseplass', 1, 1).polygon, base.walls)).toBeNull()
  })
})

describe('replaceGeometry', () => {
  it('re-attaches what stood in the variant to the new walls and rooms', () => {
    const base = flat()
    const bad = roomOf(base, 'Bad').id
    const next = redetectRooms({
      ...emptyScenario(),
      walls: [wall('t2', 0, 0, 6, 0), wall('r2', 6, 0, 6, 3), wall('b2', 6, 3, 0, 3), wall('l2', 0, 3, 0, 0)],
    })
    const s = replaceGeometry(
      { ...base, furniture: [chair(5, 1.5, bad)], fixtures: [socket(4.05, 1, 'm')], notes: [note(bad)] },
      next,
    )
    expect(s.furniture[0]!.roomId).toBe(next.rooms[0]!.id)
    expect(s.fixtures[0]!.wallId).toBeNull()
    expect(s.notes[0]!.roomId).toBeNull()
  })
})

describe('redetectRooms', () => {
  it('keeps a room drawn by hand where the walls enclose nothing', () => {
    const base = flat()
    const s = redetectRooms({ ...base, rooms: [...base.rooms, zone('z', 'Terrasse', 10, 0)] })
    expect(s.rooms.map((r) => r.name).sort()).toEqual(['Bad', 'Stue', 'Terrasse'])
  })
})
