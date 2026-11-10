import { describe, expect, it } from 'vitest'
import {
  detectRoomPolygons,
  insetPolygon,
  interiorPoint,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  snapPoint,
  wallPieces,
  v,
} from './geometry.ts'
import type { Opening, Wall } from './model.ts'

let n = 0
const wall = (ax: number, ay: number, bx: number, by: number, thickness = 0.2): Wall => ({
  id: `w${n++}`,
  a: v(ax, ay),
  b: v(bx, by),
  thickness,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
})

describe('polygonArea', () => {
  it('computes a rectangle', () => {
    expect(polygonArea([v(0, 0), v(4, 0), v(4, 3), v(0, 3)])).toBeCloseTo(12)
  })
})

describe('insetPolygon', () => {
  it('insets a square by uniform distance regardless of orientation', () => {
    const sq = [v(0, 0), v(4, 0), v(4, 4), v(0, 4)]
    expect(polygonArea(insetPolygon(sq, [0.1, 0.1, 0.1, 0.1]))).toBeCloseTo(3.8 * 3.8)
    expect(polygonArea(insetPolygon([...sq].reverse(), [0.1, 0.1, 0.1, 0.1]))).toBeCloseTo(3.8 * 3.8)
  })
})

describe('detectRoomPolygons', () => {
  it('finds one room in a closed box, measured to inner wall faces', () => {
    const rooms = detectRoomPolygons([wall(0, 0, 5, 0), wall(5, 0, 5, 4), wall(5, 4, 0, 4), wall(0, 4, 0, 0)])
    expect(rooms).toHaveLength(1)
    expect(polygonArea(rooms[0]!)).toBeCloseTo(4.8 * 3.8)
  })

  it('splits a box with a T-junction partition into two rooms', () => {
    const walls = [
      wall(0, 0, 6, 0),
      wall(6, 0, 6, 4),
      wall(6, 4, 0, 4),
      wall(0, 4, 0, 0),
      wall(3, 0, 3, 4, 0.1), // partition touching the outer walls mid-span
    ]
    const rooms = detectRoomPolygons(walls)
      .map(polygonArea)
      .sort((a, b) => a - b)
    expect(rooms).toHaveLength(2)
    // left: x 0.1..2.95, y 0.1..3.9
    expect(rooms[0]).toBeCloseTo(2.85 * 3.8, 1)
    expect(rooms[1]).toBeCloseTo(2.85 * 3.8, 1)
  })

  it('ignores dangling walls', () => {
    const rooms = detectRoomPolygons([
      wall(0, 0, 4, 0),
      wall(4, 0, 4, 4),
      wall(4, 4, 0, 4),
      wall(0, 4, 0, 0),
      wall(2, 0, 2, 2),
    ])
    expect(rooms).toHaveLength(1)
  })

  it('handles crossing walls', () => {
    const walls = [
      wall(0, 0, 4, 0),
      wall(4, 0, 4, 4),
      wall(4, 4, 0, 4),
      wall(0, 4, 0, 0),
      wall(2, 0, 2, 4),
      wall(0, 2, 4, 2),
    ]
    expect(detectRoomPolygons(walls)).toHaveLength(4)
  })
})

describe('wallPieces', () => {
  it('splits a wall around a window and a door', () => {
    const w = wall(0, 0, 5, 0)
    const ops: Opening[] = [
      { id: 'o1', wallId: w.id, kind: 'window', offset: 1, width: 1, height: 1.2, sill: 0.9, flip: false },
      { id: 'o2', wallId: w.id, kind: 'door', offset: 3.5, width: 0.9, height: 2.1, sill: 0, flip: false },
    ]
    const p = wallPieces(w, ops)
    // solid, below window, above window, solid, above door, solid
    expect(p).toHaveLength(6)
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
    const solidLength = p.filter((x) => near(x.z0, 0) && near(x.z1, 2.4)).reduce((s, x) => s + x.s1 - x.s0, 0)
    expect(solidLength).toBeCloseTo(5 - 1 - 0.9)
  })
})

describe('snapPoint', () => {
  const walls = [wall(0, 0, 4, 0)]
  it('snaps to endpoints first', () => {
    expect(snapPoint(v(3.95, 0.05), { walls, tolerance: 0.1 }).kind).toBe('endpoint')
  })
  it('snaps to 90° relative to anchor', () => {
    const r = snapPoint(v(2.05, 3), { walls, anchor: v(2, 1), tolerance: 0.1, ortho: true })
    expect(r.point.x).toBeCloseTo(2)
  })
  it('lands on a wall when the snapped ray hits it', () => {
    const r = snapPoint(v(2.02, 0.06), { walls, anchor: v(2, 2), tolerance: 0.1, ortho: true })
    expect(r.kind).toBe('wall')
    expect(r.point.y).toBeCloseTo(0)
  })
})

describe('interiorPoint', () => {
  it('is the centroid for a convex room', () => {
    expect(interiorPoint([v(0, 0), v(4, 0), v(4, 3), v(0, 3)])).toEqual(v(2, 1.5))
  })
  it('lies inside a U-shaped room, whose centroid does not', () => {
    const u = [v(0, 0), v(5, 0), v(5, 4), v(4, 4), v(4, 1), v(1, 1), v(1, 4), v(0, 4)]
    expect(pointInPolygon(polygonCentroid(u), u)).toBe(false)
    expect(pointInPolygon(interiorPoint(u), u)).toBe(true)
  })
})
