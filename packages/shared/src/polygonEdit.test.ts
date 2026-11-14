import { describe, expect, it } from 'vitest'
import { polygonArea, v } from './geometry.ts'
import type { Wall } from './model.ts'
import {
  insertVertex,
  isValidPolygon,
  moveVertex,
  polygonSelfIntersects,
  removeVertex,
  segmentsIntersect,
  snapCorner,
} from './polygonEdit.ts'

const square = [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]

describe('segmentsIntersect', () => {
  it('finds crossings and touching ends, not parallel or apart segments', () => {
    expect(segmentsIntersect(v(0, 0), v(2, 2), v(0, 2), v(2, 0))).toBe(true)
    expect(segmentsIntersect(v(0, 0), v(2, 0), v(1, 0), v(1, 2))).toBe(true) // T
    expect(segmentsIntersect(v(0, 0), v(2, 0), v(2, 0), v(3, 1))).toBe(true) // shared end
    expect(segmentsIntersect(v(0, 0), v(2, 0), v(1, 0), v(3, 0))).toBe(true) // overlap on one line
    expect(segmentsIntersect(v(0, 0), v(2, 0), v(3, 0), v(4, 0))).toBe(false) // one line, apart
    expect(segmentsIntersect(v(0, 0), v(2, 0), v(0, 1), v(2, 1))).toBe(false)
    expect(segmentsIntersect(v(0, 0), v(2, 0), v(1, 0.5), v(1, 2))).toBe(false)
  })
})

describe('polygonSelfIntersects', () => {
  it('accepts simple polygons, convex or not', () => {
    expect(polygonSelfIntersects(square)).toBe(false)
    expect(polygonSelfIntersects([v(0, 0), v(4, 0), v(4, 3), v(2, 1), v(0, 3)])).toBe(false)
  })
  it('finds a bow tie', () => {
    expect(polygonSelfIntersects([v(0, 0), v(4, 3), v(4, 0), v(0, 3)])).toBe(true)
  })
  it('finds a corner touching another edge', () => {
    expect(polygonSelfIntersects([v(0, 0), v(4, 0), v(4, 3), v(2, 0), v(0, 3)])).toBe(true)
  })
  it('finds a spike folding back along its neighbour', () => {
    expect(polygonSelfIntersects([v(0, 0), v(4, 0), v(2, 0), v(2, 3)])).toBe(true)
  })
})

describe('isValidPolygon', () => {
  it('needs three corners, an area and no tiny edge', () => {
    expect(isValidPolygon(square)).toBe(true)
    expect(isValidPolygon([v(0, 0), v(1, 0)])).toBe(false)
    expect(isValidPolygon([v(0, 0), v(1, 0), v(2, 0)])).toBe(false)
    expect(isValidPolygon([v(0, 0), v(4, 0), v(4, 0.03), v(4, 3), v(0, 3)])).toBe(false)
  })
})

describe('moveVertex', () => {
  it('moves one corner and leaves the input alone', () => {
    const moved = moveVertex(square, 2, v(5, 4))!
    expect(moved).toEqual([v(0, 0), v(4, 0), v(5, 4), v(0, 3)])
    expect(square[2]).toEqual(v(4, 3))
    expect(polygonArea(moved)).toBeGreaterThan(polygonArea(square))
  })
  it('refuses a move that makes the outline cross itself', () => {
    expect(moveVertex(square, 2, v(2, -1))).toBeNull()
    expect(moveVertex(square, 1, v(0, 5))).toBeNull()
  })
  it('refuses a move that collapses an edge', () => {
    expect(moveVertex(square, 2, v(4.02, 0.01))).toBeNull()
    expect(moveVertex(square, 2, v(4, 3.06))).not.toBeNull()
  })
  it('refuses an index outside the polygon', () => {
    expect(moveVertex(square, 4, v(1, 1))).toBeNull()
  })
})

describe('insertVertex', () => {
  it('adds a corner on an edge, after the edge start', () => {
    expect(insertVertex(square, 1, v(4, 1.5))).toEqual([v(0, 0), v(4, 0), v(4, 1.5), v(4, 3), v(0, 3)])
    expect(insertVertex(square, 3, v(0, 1))).toEqual([...square, v(0, 1)])
  })
  it('refuses a corner on top of an existing one', () => {
    expect(insertVertex(square, 0, v(0.02, 0))).toBeNull()
  })
})

describe('removeVertex', () => {
  it('removes a corner', () => {
    const five = [v(0, 0), v(4, 0), v(4, 1.5), v(4, 3), v(0, 3)]
    expect(removeVertex(five, 2)).toEqual(square)
  })
  it('keeps at least three corners', () => {
    expect(removeVertex([v(0, 0), v(1, 0), v(0, 1)], 0)).toBeNull()
  })
  it('refuses a removal that makes the outline cross itself', () => {
    const arrow = [v(0, 0), v(4, 0), v(4, 4), v(2, 1), v(0, 4)]
    expect(removeVertex(arrow, 3)).not.toBeNull()
    const notched = [v(0, 0), v(4, 0), v(4, 4), v(3, 1), v(2, 4), v(0, 4)]
    expect(removeVertex(notched, 1)).toBeNull()
  })
})

describe('snapCorner', () => {
  const opts = { walls: [] as Wall[], tolerance: 0.15, ortho: true, grid: 0.1 }

  it('keeps a rectangle square where the lines from both neighbours meet', () => {
    expect(snapCorner(v(5.07, 3.06), v(5, 0), v(0, 3), opts).point).toEqual(v(5, 3))
  })
  it('follows the 45° line from the closer neighbour away from the meeting point', () => {
    const r = snapCorner(v(6.02, 1.5), v(5, 0), v(0, 3), opts)
    expect(r.kind).toBe('angle')
    // 45° from (5, 0) is the closest line to the pointer here
    expect(r.point.x - 5).toBeCloseTo(r.point.y)
  })
  it('only snaps to the grid without ortho, and not at all without a grid', () => {
    expect(snapCorner(v(6.04, 1.53), v(5, 0), v(0, 3), { ...opts, ortho: false }).point).toEqual(v(6, 1.5))
    expect(snapCorner(v(6.04, 1.53), v(5, 0), v(0, 3), { ...opts, ortho: false, grid: undefined }).point).toEqual(
      v(6.04, 1.53),
    )
  })
  it('prefers a wall endpoint', () => {
    const wall: Wall = {
      id: 'w',
      a: v(6.1, 1.6),
      b: v(9, 1.6),
      thickness: 0.1,
      height: 2.4,
      loadBearing: 'unknown',
      exterior: false,
    }
    expect(snapCorner(v(6.04, 1.53), v(5, 0), v(0, 3), { ...opts, walls: [wall] })).toEqual({
      point: v(6.1, 1.6),
      kind: 'endpoint',
    })
  })
})
