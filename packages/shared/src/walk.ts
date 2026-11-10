import {
  add,
  clampOpening,
  closestPointOnSegment,
  lerp,
  lineIntersection,
  mul,
  sub,
  wallDir,
  wallLength,
} from './geometry.ts'
import type { Opening, Vec2, Wall } from './model.ts'

/** How close the middle of a person gets to the face of a wall (m). */
export const WALK_RADIUS = 0.15
/** A threshold up to this high is stepped over (m). */
const STEP_OVER = 0.1
/** An opening has to reach this high to be walked through upright (m). */
const HEAD_ROOM = 1.6
/** A move is taken in steps this short, so a long one cannot jump over a wall (m). */
const MAX_STEP = 0.05
/** How far into the free zone of a wall a position may be and still count as free (m). */
const SLACK = 1e-3

/** A stretch of wall nobody walks through: its centre line and half its thickness. */
export interface WalkBarrier {
  a: Vec2
  b: Vec2
  half: number
}

/** A door or a doorway down to the floor and tall enough to walk through. Windows are glass. */
function passable(o: Opening): boolean {
  return o.kind !== 'window' && o.sill <= STEP_OVER && o.sill + o.height >= HEAD_ROOM
}

/** What stops a person on foot: every wall, minus its doors and doorways. */
export function walkBarriers(walls: Wall[], openings: Opening[]): WalkBarrier[] {
  const barriers: WalkBarrier[] = []
  for (const wall of walls) {
    const L = wallLength(wall)
    if (L < 1e-6) continue
    const d = wallDir(wall)
    const stretch = (s0: number, s1: number) =>
      barriers.push({ a: add(wall.a, mul(d, s0)), b: add(wall.a, mul(d, s1)), half: wall.thickness / 2 })
    const gaps = openings
      .filter((o) => o.wallId === wall.id && passable(o))
      .map((o) => clampOpening(o, wall))
      .sort((p, q) => p.start - q.start)
    let cursor = 0
    for (const { start, end } of gaps) {
      if (start > cursor + 1e-6) stretch(cursor, start)
      cursor = Math.max(cursor, end)
    }
    if (cursor < L - 1e-6) stretch(cursor, L)
  }
  return barriers
}

function isFree(p: Vec2, barriers: WalkBarrier[], radius: number): boolean {
  return barriers.every((b) => closestPointOnSegment(p, b.a, b.b).dist >= b.half + radius - SLACK)
}

/** Moves a point out of every wall it stands too close to, straight away from the wall. */
function pushOut(p: Vec2, barriers: WalkBarrier[], radius: number): Vec2 {
  let q = p
  for (let round = 0; round < 8; round++) {
    let moved = false
    for (const b of barriers) {
      const c = closestPointOnSegment(q, b.a, b.b)
      const keep = b.half + radius
      if (c.dist >= keep - 1e-9) continue
      const d = wallDir(b)
      // On the centre line there is no "away": pick a side
      const away = c.dist > 1e-6 ? mul(sub(q, c.point), 1 / c.dist) : { x: -d.y, y: d.x }
      q = add(c.point, mul(away, keep))
      moved = true
    }
    if (!moved) break
  }
  return q
}

function crosses(p: Vec2, q: Vec2, barriers: WalkBarrier[]): boolean {
  const r = sub(q, p)
  return barriers.some((b) => {
    const hit = lineIntersection(p, r, b.a, sub(b.b, b.a))
    return !!hit && hit.t >= 0 && hit.t <= 1 && hit.u >= 0 && hit.u <= 1
  })
}

/**
 * Where a person standing at `from` ends up when heading for `to`: the same place when nothing is
 * in the way, otherwise as far as the walls allow, sliding along a wall met at an angle. Doors and
 * doorways let the person through. A person who starts inside a wall is first put next to it.
 */
export function walkStep(from: Vec2, to: Vec2, barriers: WalkBarrier[], radius = WALK_RADIUS): Vec2 {
  let p = isFree(from, barriers, radius) ? from : pushOut(from, barriers, radius)
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / MAX_STEP)
  for (let i = 1; i <= steps; i++) {
    // Aim for the next point on the straight line, so that sliding along a wall does not shorten the walk
    const next = pushOut(add(p, sub(lerp(from, to, i / steps), lerp(from, to, (i - 1) / steps))), barriers, radius)
    // A corner too tight to stand in, or a wall between here and there: stay
    if (!isFree(next, barriers, radius) || crosses(p, next, barriers)) break
    p = next
  }
  return p
}
