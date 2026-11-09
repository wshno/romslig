import { describe, expect, it } from 'vitest'
import { CATALOG, catalogById } from './catalog.ts'
import {
  doorSwingPolygon,
  findFreeSpot,
  footprint,
  frontDir,
  furnitureIssues,
  polygonsOverlap,
  snapToWall,
} from './furniture.ts'
import { polygonArea, v } from './geometry.ts'
import type { FurnitureItem, Opening, Room, Wall } from './model.ts'

const wall = (id: string, ax: number, ay: number, bx: number, by: number, thickness = 0.1): Wall => ({
  id,
  a: v(ax, ay),
  b: v(bx, by),
  thickness,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
})
const item = (id: string, catalogId: string, x: number, y: number, rotation = 0): FurnitureItem => ({
  id,
  catalogId,
  x,
  y,
  rotation,
  roomId: null,
  size: null,
  label: null,
})
// A 4 × 3 m room, walls on the centre lines 0..4 and 0..3 (inner faces at 0.05)
const box = [wall('top', 0, 0, 4, 0), wall('right', 4, 0, 4, 3), wall('bottom', 4, 3, 0, 3), wall('left', 0, 3, 0, 0)]
const room: Room = {
  id: 'r',
  name: 'R',
  type: 'soverom',
  polygon: [v(0.05, 0.05), v(3.95, 0.05), v(3.95, 2.95), v(0.05, 2.95)],
  statedArea: null,
}
const scene = (furniture: FurnitureItem[], openings: Opening[] = []) => ({
  furniture,
  walls: box,
  openings,
  rooms: [room],
})

describe('catalog', () => {
  it('has unique ids and sane sizes', () => {
    expect(catalogById.size).toBe(CATALOG.length)
    for (const c of CATALOG) expect(c.w * c.d * c.h).toBeGreaterThan(0)
  })
})

describe('footprint and orientation', () => {
  it('rotates around the centre', () => {
    const f = footprint(item('a', 'seng-180', 2, 2, 90))
    expect(polygonArea(f)).toBeCloseTo(1.8 * 2.1)
    const xs = f.map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.1) // depth now along x
  })
  it('front faces +y at 0° and -x at 90°', () => {
    expect(frontDir(0).y).toBeCloseTo(1)
    expect(frontDir(90).x).toBeCloseTo(-1)
  })
})

describe('polygonsOverlap', () => {
  const sq = (x: number, y: number, s = 1) => [v(x, y), v(x + s, y), v(x + s, y + s), v(x, y + s)]
  it('detects overlap and allows touching', () => {
    expect(polygonsOverlap(sq(0, 0), sq(0.5, 0.5))).toBe(true)
    expect(polygonsOverlap(sq(0, 0), sq(1, 0))).toBe(false)
    expect(polygonsOverlap(sq(0, 0), sq(2, 0))).toBe(false)
  })
})

describe('snapToWall', () => {
  it('backs an item onto the nearest wall face, facing into the room', () => {
    const s = snapToWall(v(2, 0.5), { d: 0.6 }, box)!
    expect(s.wallId).toBe('top')
    expect(s.y).toBeCloseTo(0.05 + 0.3, 2)
    expect(frontDir(s.rotation).y).toBeCloseTo(1) // faces down, into the room
    const r = snapToWall(v(3.6, 1.5), { d: 0.6 }, box)!
    expect(r.wallId).toBe('right')
    expect(frontDir(r.rotation).x).toBeCloseTo(-1)
  })
  it('does nothing far from walls', () => {
    expect(snapToWall(v(2, 1.5), { d: 0.6 }, box)).toBeNull()
  })
})

describe('furnitureIssues', () => {
  it('accepts a bed against the wall with room around it', () => {
    const s = snapToWall(v(2, 1), { d: 2.1 }, box)!
    expect(furnitureIssues(scene([item('bed', 'seng-160', s.x, s.y, s.rotation)])).size).toBe(0)
  })
  it('flags overlapping items and items in walls', () => {
    const issues = furnitureIssues(
      scene([item('a', 'kommode', 2, 1.5), item('b', 'kommode', 2.2, 1.5), item('c', 'kommode', 2, 0.1)]),
    )
    expect(issues.get('a')).toContainEqual({ kind: 'overlap', otherId: 'b' })
    expect(issues.get('c')?.some((i) => i.kind === 'wall')).toBe(true)
  })
  it('flags blocked free space but lets chairs stand at a table', () => {
    const issues = furnitureIssues(
      scene([item('t', 'spisebord-4', 2, 1.5), item('chair', 'spisestol', 2, 2.2, 180), item('k', 'kommode', 2, 0.75)]),
    )
    const t = issues.get('t') ?? []
    expect(t).toContainEqual({ kind: 'clearance', side: 'back', blockedBy: { furnitureId: 'k' } })
    expect(t.some((i) => i.kind === 'clearance' && i.side === 'front')).toBe(false)
  })
  it('flags clearance against a wall (wardrobe facing a wall too close)', () => {
    const issues = furnitureIssues(scene([item('g', 'garderobe-100', 2, 2.4)]))
    expect(issues.get('g')).toContainEqual({ kind: 'clearance', side: 'front', blockedBy: { wallId: 'bottom' } })
  })
  it('ignores wall cabinets above floor furniture', () => {
    expect(furnitureIssues(scene([item('b', 'benkeskap-60', 1, 0.36), item('o', 'overskap-60', 1, 0.23)])).size).toBe(0)
  })
  it('flags furniture in a door swing', () => {
    const door: Opening = {
      id: 'd',
      wallId: 'top',
      kind: 'door',
      offset: 2,
      width: 0.9,
      height: 2.1,
      sill: 0,
      flip: true,
    }
    expect(polygonArea(doorSwingPolygon(door, box[0]!)!)).toBeCloseTo(0.81)
    const issues = furnitureIssues(scene([item('k', 'kommode', 2, 0.4)], [door]))
    expect(issues.get('k')).toContainEqual({ kind: 'door', openingId: 'd' })
    // Swinging out of the room instead: no conflict
    expect(furnitureIssues(scene([item('k', 'kommode', 2, 0.4)], [{ ...door, flip: false }])).get('k')).toBeUndefined()
  })
  it('flags items outside every room', () => {
    expect(furnitureIssues(scene([item('x', 'plante', 6, 6)])).get('x')).toContainEqual({ kind: 'outside' })
  })
})

describe('findFreeSpot', () => {
  it('places items next to each other along the walls without problems', () => {
    let furniture: FurnitureItem[] = []
    for (const [i, id] of ['seng-160', 'garderobe-100', 'kommode', 'nattbord'].entries()) {
      const spot = findFreeSpot(scene(furniture), id, room)
      expect(spot).not.toBeNull()
      furniture = [...furniture, item(`i${i}`, id, spot!.x, spot!.y, spot!.rotation)]
    }
    expect(furnitureIssues(scene(furniture)).size).toBe(0)
  })
  it('puts tables in the open floor', () => {
    const spot = findFreeSpot(scene([]), 'spisebord-4', room)!
    expect(spot.x).toBeCloseTo(2, 0)
    expect(spot.y).toBeCloseTo(1.5, 0)
  })
  it('gives up when the room is full', () => {
    const tiny: Room = { ...room, polygon: [v(0.05, 0.05), v(1, 0.05), v(1, 1), v(0.05, 1)] }
    expect(findFreeSpot(scene([]), 'seng-180', tiny)).toBeNull()
  })
})

describe('findFreeSpot options', () => {
  it('puts an item against the preferred wall', () => {
    const spot = findFreeSpot(scene([]), 'kommode', room, { preferSide: 'bottom' })!
    expect(spot.y).toBeGreaterThan(2.5) // against the bottom wall, facing up
    expect(frontDir(spot.rotation).y).toBeCloseTo(-1)
  })
  it('uses a size override', () => {
    const spot = findFreeSpot(scene([]), 'sofa-3', room, { size: { w: 3.5, d: 1, h: 0.8 }, preferSide: 'top' })!
    expect(spot.x).toBeCloseTo(2, 0) // only fits along the 3.9 m wall, centred
  })
})

describe('chairs at tables', () => {
  it('lets a chair be pushed in under a desk, but not into a wardrobe', () => {
    const issues = furnitureIssues(
      scene([
        item('desk', 'skrivebord', 2, 0.4),
        item('chair', 'kontorstol', 2, 0.8, 180),
        item('g', 'garderobe-100', 3.4, 2.6, 180),
        item('c2', 'spisestol', 3.4, 2.2),
      ]),
    )
    expect(issues.get('desk')).toBeUndefined()
    expect(issues.get('chair')).toBeUndefined()
    expect(issues.get('c2')).toContainEqual({ kind: 'overlap', otherId: 'g' })
  })
})

describe('findFreeSpot for chairs', () => {
  it('puts a chair at the desk, facing it', () => {
    const desk = item('desk', 'skrivebord', 2, 0.4) // against the top wall, front faces +y
    const spot = findFreeSpot(scene([{ ...desk, roomId: 'r' }]), 'kontorstol', room)!
    expect(spot.x).toBeCloseTo(1.65, 1) // first seat on a wide desk
    expect(spot.y).toBeGreaterThan(0.7)
    expect(spot.y).toBeLessThan(1.2)
    expect(frontDir(spot.rotation).y).toBeCloseTo(-1) // faces the desk
  })
})
