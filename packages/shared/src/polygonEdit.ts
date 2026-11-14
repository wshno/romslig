import { add, cross, dist, dot, lineIntersection, mul, polygonArea, snapPoint, sub, type SnapKind } from './geometry.ts'
import type { Vec2, Wall } from './model.ts'

/**
 * Editing the corners of a polygon by hand (rooms drawn across an open area): moving, inserting and
 * removing a corner, refusing any change that leaves an outline that is no longer a simple polygon.
 *
 * All functions are pure and return a new array, or null when the change is refused.
 */

/** Edges shorter than this are refused: two corners that close are one corner (m). */
export const MIN_POLYGON_EDGE = 0.05

const EPS = 1e-9

/** Which side of the line a→b the point p lies on: >0 left, <0 right, 0 on it (with a small tolerance). */
function orient(a: Vec2, b: Vec2, p: Vec2): number {
  const c = cross(sub(b, a), sub(p, a))
  return Math.abs(c) < EPS ? 0 : Math.sign(c)
}

/** p lies on the segment a–b, given it is on the line through them. */
const onSegment = (a: Vec2, b: Vec2, p: Vec2) =>
  Math.min(a.x, b.x) - EPS <= p.x &&
  p.x <= Math.max(a.x, b.x) + EPS &&
  Math.min(a.y, b.y) - EPS <= p.y &&
  p.y <= Math.max(a.y, b.y) + EPS

/** The segments p1–p2 and q1–q2 cross or touch (sharing a point counts). */
export function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const o1 = orient(p1, p2, q1)
  const o2 = orient(p1, p2, q2)
  const o3 = orient(q1, q2, p1)
  const o4 = orient(q1, q2, p2)
  // A crossing, or an end of one lying on the other (the lines are not the same)
  if (o1 !== o2 && o3 !== o4) return true
  // On one line: they meet when an end of one lies within the other
  if (o1 === 0 && onSegment(p1, p2, q1)) return true
  if (o2 === 0 && onSegment(p1, p2, q2)) return true
  if (o3 === 0 && onSegment(q1, q2, p1)) return true
  if (o4 === 0 && onSegment(q1, q2, p2)) return true
  return false
}

/**
 * True when the outline crosses or touches itself: two edges that are not neighbours meet, or two
 * neighbouring edges fold back over each other (a spike).
 */
export function polygonSelfIntersects(poly: Vec2[]): boolean {
  const n = poly.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % n]!
    const c = poly[(i + 2) % n]!
    // Neighbouring edges a→b and b→c fold back when they lie on one line and point opposite ways
    if (orient(a, b, c) === 0 && dot(sub(b, a), sub(c, b)) < 0) return true
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // the last edge is the first one's neighbour
      if (segmentsIntersect(a, b, poly[j]!, poly[(j + 1) % n]!)) return true
    }
  }
  return false
}

/**
 * A polygon a room can have: at least three corners, no edge shorter than MIN_POLYGON_EDGE, an
 * area, and an outline that does not cross or touch itself.
 */
export function isValidPolygon(poly: Vec2[], minEdge = MIN_POLYGON_EDGE): boolean {
  const n = poly.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) if (dist(poly[i]!, poly[(i + 1) % n]!) < minEdge) return false
  return polygonArea(poly) > 1e-6 && !polygonSelfIntersects(poly)
}

/** The polygon with corner i moved to `to`, or null when that leaves an invalid polygon (see isValidPolygon). */
export function moveVertex(poly: Vec2[], i: number, to: Vec2): Vec2[] | null {
  if (i < 0 || i >= poly.length) return null
  const next = poly.map((p, k) => (k === i ? { x: to.x, y: to.y } : p))
  return isValidPolygon(next) ? next : null
}

/**
 * The polygon with a new corner at `at` on edge `edge` (from corner `edge` to the next one), or
 * null when it would leave an edge shorter than MIN_POLYGON_EDGE or an invalid polygon.
 */
export function insertVertex(poly: Vec2[], edge: number, at: Vec2): Vec2[] | null {
  if (edge < 0 || edge >= poly.length) return null
  const next = [...poly.slice(0, edge + 1), { x: at.x, y: at.y }, ...poly.slice(edge + 1)]
  return isValidPolygon(next) ? next : null
}

/** The polygon without corner i, or null when fewer than three corners would be left or it becomes invalid. */
export function removeVertex(poly: Vec2[], i: number): Vec2[] | null {
  if (i < 0 || i >= poly.length || poly.length <= 3) return null
  const next = poly.filter((_, k) => k !== i)
  return isValidPolygon(next) ? next : null
}

/** The direction from `anchor` toward `p`, turned to the nearest 45°. */
function angleDir(anchor: Vec2, p: Vec2): Vec2 | null {
  const d = sub(p, anchor)
  if (Math.hypot(d.x, d.y) < 1e-6) return null
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(d.y, d.x) / step) * step
  return { x: Math.cos(ang), y: Math.sin(ang) }
}

/**
 * Snaps a polygon corner that is being dragged, between its neighbours `prev` and `next`. Like
 * snapPoint (wall endpoints, walls, 45° from a neighbour, the grid), and with `ortho` the corner
 * also lands where the 45° lines from both neighbours meet when that is within `tolerance`, so a
 * rectangle stays a rectangle; otherwise it takes the 45° line from whichever neighbour is closer.
 */
export function snapCorner(
  p: Vec2,
  prev: Vec2,
  next: Vec2,
  opts: { walls: Wall[]; tolerance: number; ortho?: boolean; grid?: number },
): { point: Vec2; kind: SnapKind } {
  const fromPrev = snapPoint(p, { ...opts, anchor: prev })
  if (!opts.ortho || fromPrev.kind !== 'angle') return fromPrev
  const d1 = angleDir(prev, p)
  const d2 = angleDir(next, p)
  const ix = d1 && d2 ? lineIntersection(prev, d1, next, d2) : null
  if (ix) {
    const meet = add(prev, mul(d1!, ix.t))
    if (dist(meet, p) < opts.tolerance) return { point: meet, kind: 'angle' }
  }
  const fromNext = snapPoint(p, { ...opts, anchor: next })
  if (fromNext.kind !== 'angle') return fromNext
  return dist(fromNext.point, p) < dist(fromPrev.point, p) ? fromNext : fromPrev
}
