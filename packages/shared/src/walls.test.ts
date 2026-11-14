import { describe, expect, it } from 'vitest'
import { pointInPolygon, polygonArea, v } from './geometry.ts'
import type { Vec2, Wall } from './model.ts'
import { WALL_JOIN_TOLERANCE, wallFootprint } from './walls.ts'

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

/** Rounded to a nanometre (and -0 to 0), so points can be compared with toEqual. */
const rounded = (ps: Vec2[]) =>
  ps.map((p) => ({ x: Math.round(p.x * 1e9) / 1e9 + 0, y: Math.round(p.y * 1e9) / 1e9 + 0 }))
const hasPoint = (poly: Vec2[], p: Vec2) => poly.some((q) => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9)

describe('wallFootprint', () => {
  it('has square ends where nothing connects', () => {
    const w = wall(0, 0, 4, 0)
    expect(rounded(wallFootprint(w, [w]))).toEqual(rounded([v(0, 0.1), v(4, 0.1), v(4, -0.1), v(0, -0.1)]))
  })

  it('mitres an L-corner at 90°: the outer corner is where the outer faces meet', () => {
    const h = wall(0, 0, 4, 0)
    const vert = wall(0, 0, 0, 3)
    const walls = [h, vert]
    const fh = wallFootprint(h, walls)
    const fv = wallFootprint(vert, walls)
    // Outer corner (-0.1, -0.1) and inner corner (0.1, 0.1) are shared by both walls
    for (const f of [fh, fv]) {
      expect(hasPoint(f, v(-0.1, -0.1))).toBe(true)
      expect(hasPoint(f, v(0.1, 0.1))).toBe(true)
    }
    expect(rounded(fh)).toEqual(rounded([v(0.1, 0.1), v(4, 0.1), v(4, -0.1), v(-0.1, -0.1)]))
    // Together they cover the corner square exactly once: same area as the two centre lines' lengths × thickness
    expect(polygonArea(fh) + polygonArea(fv)).toBeCloseTo((4 + 3) * 0.2, 9)
  })

  it('treats endpoints within the join tolerance as one corner', () => {
    const h = wall(0, 0, 4, 0)
    const vert = wall(WALL_JOIN_TOLERANCE / 2, 0, 0, 3)
    const outer = wallFootprint(h, [h, vert])[3]!
    expect(outer.x).toBeCloseTo(-0.1, 2)
    expect(outer.y).toBeCloseTo(-0.1, 9)
  })

  it('ends a wall standing against the side of another flush with that face (T-junction)', () => {
    const host = wall(0, 0, 4, 0)
    const stem = wall(2, 3, 2, 0)
    const walls = [host, stem]
    expect(rounded(wallFootprint(stem, walls))).toEqual(rounded([v(2.1, 3), v(2.1, 0.1), v(1.9, 0.1), v(1.9, 3)]))
    // The host is not affected by the stem
    expect(rounded(wallFootprint(host, walls))).toEqual(rounded([v(0, 0.1), v(4, 0.1), v(4, -0.1), v(0, -0.1)]))
  })

  it('ends flush against a host of another thickness on the side the wall stands', () => {
    const host = wall(0, 0, 4, 0, 0.3)
    const stem = wall(2, -2, 2, 0, 0.1)
    const f = wallFootprint(stem, [host, stem])
    expect(Math.max(...f.map((p) => p.y))).toBeCloseTo(-0.15, 9)
  })

  it('runs through the shared point when three walls meet there, leaving no gap', () => {
    const east = wall(0, 0, 3, 0)
    const west = wall(0, 0, -3, 0)
    const south = wall(0, 0, 0, 3)
    const walls = [east, west, south]
    const fe = wallFootprint(east, walls)
    const fw = wallFootprint(west, walls)
    const fs = wallFootprint(south, walls)
    for (const f of [fe, fw, fs]) expect(hasPoint(f, v(0, 0))).toBe(true)
    // The straight run continues square on the side without a branch, and meets the branch's faces
    expect(hasPoint(fe, v(0, -0.1))).toBe(true)
    expect(hasPoint(fe, v(0.1, 0.1))).toBe(true)
    expect(hasPoint(fs, v(0.1, 0.1))).toBe(true)
    expect(hasPoint(fs, v(-0.1, 0.1))).toBe(true)
    // Every point of the junction square is covered by one of them
    for (const p of [v(0.01, 0.05), v(-0.01, 0.05), v(0, -0.05), v(0.05, 0.09), v(-0.05, 0.09)]) {
      expect([fe, fw, fs].some((f) => pointInPolygon(p, f))).toBe(true)
    }
    // ...and the three together cover the T exactly: 6 m of run plus the branch beyond the run's face
    expect(polygonArea(fe) + polygonArea(fw) + polygonArea(fs)).toBeCloseTo(6 * 0.2 + 2.9 * 0.2, 9)
  })

  it('caps very acute corners with square ends instead of a spike', () => {
    const angle = (10 * Math.PI) / 180
    const a = wall(0, 0, 3, 0)
    const b = wall(0, 0, 3 * Math.cos(angle), 3 * Math.sin(angle))
    const f = wallFootprint(a, [a, b])
    expect(rounded(f)).toEqual(rounded([v(0, 0.1), v(3, 0.1), v(3, -0.1), v(0, -0.1)]))
    // A moderate angle (60°) is still mitred
    const c = wall(0, 0, 3 * Math.cos(Math.PI / 3), 3 * Math.sin(Math.PI / 3))
    const g = wallFootprint(a, [a, c])
    expect(g[0]!.x).toBeCloseTo(0.1 / Math.tan(Math.PI / 6), 9)
    expect(g[3]!.x).toBeCloseTo(-0.1 / Math.tan(Math.PI / 6), 9)
  })

  it('mitres walls of different thickness so their faces meet', () => {
    const thick = wall(0, 0, 4, 0, 0.3)
    const thin = wall(0, 0, 0, 3, 0.1)
    const walls = [thick, thin]
    const ft = wallFootprint(thick, walls)
    const fn = wallFootprint(thin, walls)
    // Outer corner: thick wall's outer face (y = -0.15) meets the thin wall's outer face (x = -0.05)
    for (const f of [ft, fn]) {
      expect(hasPoint(f, v(-0.05, -0.15))).toBe(true)
      expect(hasPoint(f, v(0.05, 0.15))).toBe(true)
    }
    expect(polygonArea(ft) + polygonArea(fn)).toBeCloseTo(4 * 0.3 + 3 * 0.1, 9)
  })

  it('falls back to a plain rectangle when the trimmed ends would cross on a short wall', () => {
    const left = wall(0, 0, 0, 3)
    const right = wall(0.1, 0, 0.1, 3)
    const short = wall(0, 0, 0.1, 0)
    const f = wallFootprint(short, [left, right, short])
    expect(rounded(f)).toEqual(rounded([v(0, 0.1), v(0.1, 0.1), v(0.1, -0.1), v(0, -0.1)]))
  })
})
