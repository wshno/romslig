import { add, closestPointOnSegment, dist, dot, lineIntersection, mul, sub, wallDir, wallLength } from './geometry.ts'
import type { Vec2, Wall } from './model.ts'

/** Wall endpoints closer than this meet in the same corner, and an end this close to a wall stands against it (m). */
export const WALL_JOIN_TOLERANCE = 0.02

/**
 * A mitred corner point may lie at most this many half thicknesses (of the thicker wall) from the
 * point where the centre lines meet. Beyond that (walls meeting at less than about 29°) the end is
 * cut square instead, so the outline does not spike.
 */
export const WALL_MITRE_LIMIT = 4

type WallLine = Pick<Wall, 'a' | 'b' | 'thickness'>
type WallRef = WallLine & Pick<Wall, 'id'>

const leftOf = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x })

/** One end of a wall: the corner on its left face, the one on its right face, and whether the centre point belongs in between. */
interface WallEndShape {
  left: Vec2
  right: Vec2
  centre: Vec2 | null
}

/**
 * Where the face line (p, dir) meets the face line (q, dirQ), or null when they are parallel or the
 * corner would be further than the mitre limit from `node`.
 */
function faceCorner(p: Vec2, dir: Vec2, q: Vec2, dirQ: Vec2, node: Vec2, limit: number): Vec2 | null {
  const ix = lineIntersection(p, dir, q, dirQ)
  if (!ix) return null
  const corner = add(p, mul(dir, ix.t))
  return dist(corner, node) <= limit ? corner : null
}

/**
 * The shape of the end of `wall` at `node` (wall.a or wall.b). `u` points from the node into the
 * wall and `left` is its left normal.
 */
function endShape(wall: WallRef, node: Vec2, walls: readonly WallRef[]): WallEndShape {
  const h = wall.thickness / 2
  const u = node === wall.a ? wallDir(wall) : mul(wallDir(wall), -1)
  const n = leftOf(u)
  const square: WallEndShape = { left: add(node, mul(n, h)), right: sub(node, mul(n, h)), centre: null }
  const others = walls.filter((o) => o.id !== wall.id && wallLength(o) > WALL_JOIN_TOLERANCE)

  // T-junction: the end stands against the side of another wall, so it stops flush with that face
  let host: { wall: WallRef; d: number } | null = null
  for (const o of others) {
    const c = closestPointOnSegment(node, o.a, o.b)
    const along = c.t * wallLength(o)
    if (c.dist > WALL_JOIN_TOLERANCE || along < WALL_JOIN_TOLERANCE || wallLength(o) - along < WALL_JOIN_TOLERANCE)
      continue
    if (!host || c.dist < host.d) host = { wall: o, d: c.dist }
  }
  if (host) {
    const o = host.wall
    const dO = wallDir(o)
    const nO = leftOf(dO)
    const side = dot(u, nO) >= 0 ? 1 : -1
    const face = add(o.a, mul(nO, (side * o.thickness) / 2))
    const limit = WALL_MITRE_LIMIT * Math.max(h, o.thickness / 2)
    const left = faceCorner(square.left, u, face, dO, node, limit)
    const right = faceCorner(square.right, u, face, dO, node, limit)
    return left && right ? { left, right, centre: null } : square
  }

  // Corner: the nearest wall turning to the left meets the left face, the nearest turning right the right face
  const base = Math.atan2(u.y, u.x)
  let toLeft: { o: WallRef; dir: Vec2; delta: number } | null = null
  let toRight: { o: WallRef; dir: Vec2; delta: number } | null = null
  for (const o of others) {
    for (const end of [o.a, o.b]) {
      if (dist(end, node) >= WALL_JOIN_TOLERANCE) continue
      const dir = end === o.a ? wallDir(o) : mul(wallDir(o), -1)
      let delta = Math.atan2(dir.y, dir.x) - base
      while (delta < 0) delta += Math.PI * 2
      while (delta >= Math.PI * 2) delta -= Math.PI * 2
      if (delta < 1e-6 || delta > Math.PI * 2 - 1e-6) continue // lies on top of this wall
      if (!toLeft || delta < toLeft.delta) toLeft = { o, dir, delta }
      if (!toRight || delta > toRight.delta) toRight = { o, dir, delta }
    }
  }
  if (!toLeft || !toRight) return square

  const cornerWith = (j: { o: WallRef; dir: Vec2 }, sign: 1 | -1): Vec2 => {
    const hO = j.o.thickness / 2
    // Our face on that side meets the neighbour's face that looks back at us
    const ours = sign > 0 ? square.left : square.right
    const theirs = add(node, mul(leftOf(j.dir), -sign * hO))
    return faceCorner(ours, u, theirs, j.dir, node, WALL_MITRE_LIMIT * Math.max(h, hO)) ?? ours
  }
  return {
    left: cornerWith(toLeft, 1),
    right: cornerWith(toRight, -1),
    // With three or more walls the corners alone leave a gap around the node, so the outline runs through it
    centre: toLeft.o.id !== toRight.o.id ? { ...node } : null,
  }
}

/** The plain rectangle around the centre line, with square ends. */
export function wallRectangle(w: WallLine): Vec2[] {
  const n = mul(leftOf(wallDir(w)), w.thickness / 2)
  return [add(w.a, n), add(w.b, n), sub(w.b, n), sub(w.a, n)]
}

/**
 * The outline of a wall in plan, as it should be drawn and tested against:
 * - where it meets other walls end to end, both faces are extended or trimmed to meet the
 *   neighbouring wall's faces (mitred corners, also between walls of different thickness);
 *   with three or more walls in one point the outline also runs through that point, so the
 *   walls together cover the junction without gaps,
 * - where its end stands against the side of another wall (T-junction), it stops flush with
 *   that wall's face,
 * - otherwise, and where a mitre would reach further than WALL_MITRE_LIMIT half thicknesses
 *   from the corner (very acute angles), the end is square.
 * Endpoints within WALL_JOIN_TOLERANCE count as meeting. `walls` may include `wall` itself.
 *
 * The points run along the left face from a to b, across the b end and back along the right face.
 * The outline is convex except at a junction of three or more walls.
 */
export function wallFootprint(wall: WallRef, walls: readonly WallRef[]): Vec2[] {
  if (wallLength(wall) < 1e-9) return wallRectangle(wall)
  const atA = endShape(wall, wall.a, walls)
  const atB = endShape(wall, wall.b, walls)
  // At end b the wall's left face is the end's right side
  const d = wallDir(wall)
  // Ends trimmed so far on a short wall that the faces turn back on themselves: draw it plain
  if (dot(sub(atB.right, atA.left), d) < 1e-6 || dot(sub(atB.left, atA.right), d) < 1e-6) return wallRectangle(wall)
  const pts = [atA.left, atB.right]
  if (atB.centre) pts.push(atB.centre)
  pts.push(atB.left, atA.right)
  if (atA.centre) pts.push(atA.centre)
  return pts
}

/** The footprint of every wall, by id. */
export function wallFootprints(walls: readonly WallRef[]): Map<string, Vec2[]> {
  return new Map(walls.map((w) => [w.id, wallFootprint(w, walls)]))
}
