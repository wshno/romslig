import {
  add,
  closestPointOnSegment,
  cross,
  detectRoomPolygons,
  dist,
  dot,
  interiorPoint,
  lerp,
  lineIntersection,
  mul,
  norm,
  pointInPolygon,
  polygonArea,
  sub,
  wallDir,
  wallLength,
} from './geometry.ts'
import { roomAt } from './furniture.ts'
import type { Opening, Room, Scenario, Vec2, Wall } from './model.ts'

/**
 * Edits to a variant that keep it consistent: connected walls stay connected, openings and
 * wall-mounted fixtures stay where they were on their wall, rooms follow the walls they are bounded
 * by, and nothing is left pointing at a wall or room that no longer exists.
 *
 * All functions are pure: they return a new scenario and leave the one they were given untouched.
 */

/** Endpoints closer than this are the same corner (m). */
const JOIN_EPS = 0.02

export type WallEnd = 'a' | 'b'
const ENDS: readonly WallEnd[] = ['a', 'b']
type Segment = Pick<Wall, 'a' | 'b'>

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

const scaleVec = (p: Vec2, k: number): Vec2 => ({ x: p.x * k, y: p.y * k })

/**
 * Multiplies every plan position by k. Used when the scale of the floor plan image changes: what
 * was traced over the image has to stay on top of it. Sizes that were entered as real measures
 * (wall thickness, heights, furniture) are left alone; opening widths were traced, so they follow.
 */
export function rescaleScenario(s: Scenario, k: number): Scenario {
  if (k === 1) return s
  return {
    ...s,
    walls: s.walls.map((w) => ({ ...w, a: scaleVec(w.a, k), b: scaleVec(w.b, k) })),
    openings: s.openings.map((o) => ({ ...o, offset: o.offset * k, width: o.width * k })),
    rooms: s.rooms.map((r) => ({ ...r, polygon: r.polygon.map((p) => scaleVec(p, k)) })),
    furniture: s.furniture.map((f) => ({ ...f, x: f.x * k, y: f.y * k })),
    fixtures: s.fixtures.map((x) => ({ ...x, x: x.x * k, y: x.y * k })),
    runs: s.runs.map((r) => ({ ...r, points: r.points.map((p) => scaleVec(p, k)) })),
    loweredCeilings: s.loweredCeilings.map((c) => ({ ...c, polygon: c.polygon.map((p) => scaleVec(p, k)) })),
  }
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * Removes what points at walls and rooms that are gone: openings in a missing wall are dropped,
 * fixtures are detached from it, notes lose their room, and every piece of furniture is assigned
 * to the room it now stands in.
 */
export function tidyReferences(s: Scenario): Scenario {
  const wallIds = new Set(s.walls.map((w) => w.id))
  const roomIds = new Set(s.rooms.map((r) => r.id))
  const openings = s.openings.filter((o) => wallIds.has(o.wallId))
  const keep = <T>(list: T[], fix: (x: T) => T): T[] => {
    let changed = false
    const out = list.map((x) => {
      const y = fix(x)
      if (y !== x) changed = true
      return y
    })
    return changed ? out : list
  }
  return {
    ...s,
    openings: openings.length === s.openings.length ? s.openings : openings,
    fixtures: keep(s.fixtures, (x) => (x.wallId && !wallIds.has(x.wallId) ? { ...x, wallId: null } : x)),
    furniture: keep(s.furniture, (f) => {
      const roomId = roomAt(f, s.rooms)?.id ?? null
      return roomId === f.roomId ? f : { ...f, roomId }
    }),
    notes: keep(s.notes, (n) => (n.roomId && !roomIds.has(n.roomId) ? { ...n, roomId: null } : n)),
  }
}

// ---------------------------------------------------------------------------
// Rooms that follow their walls
// ---------------------------------------------------------------------------

/**
 * The walls a polygon is bounded by, or null when part of its outline does not run along a wall
 * (a zone the user drew across an open room). Short edges are ignored: they are the steps a
 * polygon takes around wall ends.
 */
export function boundingWalls(polygon: Vec2[], walls: Wall[]): string[] | null {
  const ids = new Set<string>()
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!
    const q = polygon[(i + 1) % polygon.length]!
    if (dist(p, q) < 0.15) continue
    const mid = lerp(p, q, 0.5)
    const dir = norm(sub(q, p))
    let best: { id: string; d: number } | null = null
    for (const w of walls) {
      if (Math.abs(cross(dir, wallDir(w))) > 0.1) continue
      const c = closestPointOnSegment(mid, w.a, w.b)
      if (c.dist <= w.thickness / 2 + 0.03 && (!best || c.dist < best.d)) best = { id: w.id, d: c.dist }
    }
    if (!best) return null
    ids.add(best.id)
  }
  return ids.size ? [...ids] : null
}

function similarity(a: string[], b: string[]): number {
  const shared = a.filter((x) => b.includes(x)).length
  return shared / (a.length + b.length - shared || 1)
}

interface Face {
  polygon: Vec2[]
  walls: string[]
  inside: Vec2
}

const facesOf = (walls: Wall[]): Face[] =>
  detectRoomPolygons(walls).map((polygon) => ({
    polygon,
    walls: boundingWalls(polygon, walls) ?? [],
    inside: interiorPoint(polygon),
  }))

/** The enclosed area that best continues `polygon` (bounded by `bounds`), or -1. */
function matchFace(polygon: Vec2[], bounds: string[], faces: Face[]): number {
  const inside = interiorPoint(polygon)
  let best = -1
  let bestScore = 0
  faces.forEach((f, i) => {
    if (!pointInPolygon(inside, f.polygon) && !pointInPolygon(f.inside, polygon)) return
    const score = similarity(bounds, f.walls)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  })
  return best
}

/**
 * Call after the walls have changed (`prevWalls` is what they were). Rooms that were bounded by
 * walls on all sides take the shape of the enclosed area they have become, measured to the inside
 * face of the walls. When two rooms have become one, the larger one stays. Rooms drawn across an
 * open area, and rooms that are no longer enclosed, are left as they are. References are tidied.
 */
export function followWalls(prevWalls: Wall[], s: Scenario): Scenario {
  if (!s.rooms.length) return tidyReferences(s)
  const faces = facesOf(s.walls)
  const claimed = new Set<number>()
  const result = new Map<string, Vec2[] | null>()
  const bySize = [...s.rooms].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))
  for (const r of bySize) {
    const bounds = r.polygon.length >= 3 ? boundingWalls(r.polygon, prevWalls) : null
    if (!bounds) continue
    const i = matchFace(r.polygon, bounds, faces)
    if (i < 0) continue
    if (claimed.has(i)) result.set(r.id, null)
    else {
      claimed.add(i)
      result.set(r.id, faces[i]!.polygon)
    }
  }
  const rooms: Room[] = s.rooms.flatMap((r) => {
    const polygon = result.get(r.id)
    if (polygon === undefined) return [r]
    return polygon ? [{ ...r, polygon }] : []
  })
  return tidyReferences({ ...s, rooms })
}

/**
 * A room the user traced by clicking wall corners lies on the walls' centre lines. When it matches
 * an enclosed area, that area is returned instead: measured to the inside of the walls, like the
 * rooms that are detected automatically, so its m² can be compared with the plan's. Any other
 * outline is returned as drawn.
 */
export function fitRoomToWalls(polygon: Vec2[], walls: Wall[]): Vec2[] {
  const bounds = polygon.length >= 3 ? boundingWalls(polygon, walls) : null
  if (!bounds) return polygon
  const faces = facesOf(walls)
  const face = faces[matchFace(polygon, bounds, faces)]
  if (!face || similarity(bounds, face.walls) < 0.75) return polygon
  const drawn = polygonArea(polygon)
  return Math.abs(polygonArea(face.polygon) - drawn) < drawn * 0.25 ? face.polygon : polygon
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/** Where the point `along` metres from w.a ends up when w becomes g: measured from the end that stands still. */
function alongAfter(w: Segment, g: Segment, along: number): number {
  const before = wallLength(w)
  const after = wallLength(g)
  const aMoved = dist(w.a, g.a) > 1e-9
  const bMoved = dist(w.b, g.b) > 1e-9
  if (aMoved && bMoved) return before > 0 ? (along / before) * after : 0
  return aMoved ? after - (before - along) : along
}

const pointAlong = (g: Segment, along: number): Vec2 =>
  add(g.a, mul(wallDir(g), Math.max(0, Math.min(wallLength(g), along))))

interface Attachment {
  /** Endpoints that sit in the dragged corner (the wall's own end included). */
  corner: { id: string; end: WallEnd }[]
  /** Endpoints that butt against the side of a wall that moves, in the order they were found. */
  butting: { id: string; end: WallEnd; hostId: string; along: number }[]
}

function attachments(s: Scenario, wallId: string, end: WallEnd): Attachment | null {
  const wall = s.walls.find((w) => w.id === wallId)
  if (!wall) return null
  const from = wall[end]
  const corner = s.walls.flatMap((w) =>
    ENDS.filter((e) => (w.id === wallId ? e === end : dist(w[e], from) < JOIN_EPS)).map((e) => ({ id: w.id, end: e })),
  )
  const taken = new Set(corner.map((c) => `${c.id}:${c.end}`))
  const butting: Attachment['butting'] = []
  const queue = [...new Set(corner.map((c) => c.id))]
  const queued = new Set(queue)
  while (queue.length) {
    const hostId = queue.shift()
    const host = s.walls.find((w) => w.id === hostId)!
    const length = wallLength(host)
    for (const w of s.walls) {
      if (w.id === host.id) continue
      for (const e of ENDS) {
        if (taken.has(`${w.id}:${e}`)) continue
        const c = closestPointOnSegment(w[e], host.a, host.b)
        const along = c.t * length
        // Only the side of the host: its ends are corners, and those were handled above
        if (c.dist > JOIN_EPS || along < JOIN_EPS || length - along < JOIN_EPS) continue
        taken.add(`${w.id}:${e}`)
        butting.push({ id: w.id, end: e, hostId: host.id, along })
        if (!queued.has(w.id)) {
          queued.add(w.id)
          queue.push(w.id)
        }
      }
    }
  }
  return { corner, butting }
}

/** The walls that change when this end of the wall is moved (the wall itself included). */
export function wallsMovedWith(s: Scenario, wallId: string, end: WallEnd): string[] {
  const at = attachments(s, wallId, end)
  return at ? [...new Set([...at.corner, ...at.butting].map((x) => x.id))] : []
}

/**
 * Where the end of a wall that stands against the side of `host` goes when the host has become
 * `now`: the wall is made longer or shorter in its own direction until it meets the host again, so
 * it stays parallel to what it was. When that is not possible (the host has been turned parallel
 * to it), it keeps its distance from the end of the host that stands still.
 */
function buttAgainst(guest: Segment, end: WallEnd, far: Vec2, host: Segment, now: Segment, along: number): Vec2 {
  const dir = end === 'a' ? sub(guest.a, guest.b) : sub(guest.b, guest.a)
  const hit = lineIntersection(far, dir, now.a, sub(now.b, now.a))
  if (hit && hit.t > 0.05) return lerp(now.a, now.b, Math.max(0, Math.min(1, hit.u)))
  return pointAlong(now, alongAfter(host, now, along))
}

/**
 * Moves one end of a wall. Walls that meet it in that corner come along, and walls that stand
 * against the side of a wall that moves are made longer or shorter so they keep touching it.
 * Openings and wall-mounted fixtures keep their distance from the end of their wall that stands
 * still, so a door does not slide along the wall when the other end is dragged. Rooms follow (see
 * followWalls).
 *
 * Meant to be applied to the scenario as it was when the drag started, with the pointer's current
 * position: the result does not depend on the path the pointer took.
 */
export function moveWallEndpoint(s: Scenario, wallId: string, end: WallEnd, to: Vec2): Scenario {
  const at = attachments(s, wallId, end)
  if (!at) return s
  const original = new Map(s.walls.map((w) => [w.id, w]))
  const moved = new Map<string, Segment>()
  const current = (id: string): Segment => moved.get(id) ?? original.get(id)!
  const setEnd = (id: string, e: WallEnd, p: Vec2) => moved.set(id, { ...current(id), [e]: p })

  for (const c of at.corner) setEnd(c.id, c.end, to)
  // A wall can be both host and guest, so repeat until every guest sits on its host
  for (let round = 0; round < 8; round++) {
    let changed = false
    for (const b of at.butting) {
      const far = current(b.id)[b.end === 'a' ? 'b' : 'a']
      const p = buttAgainst(original.get(b.id)!, b.end, far, original.get(b.hostId)!, current(b.hostId), b.along)
      if (dist(p, current(b.id)[b.end]) < 1e-9) continue
      setEnd(b.id, b.end, p)
      changed = true
    }
    if (!changed) break
  }

  const walls = s.walls.map((w) => (moved.has(w.id) ? { ...w, ...moved.get(w.id)! } : w))
  const openings = s.openings.map((o): Opening => {
    const g = moved.get(o.wallId)
    return g ? { ...o, offset: alongAfter(original.get(o.wallId)!, g, o.offset) } : o
  })
  const fixtures = s.fixtures.map((x) => {
    const g = x.wallId ? moved.get(x.wallId) : undefined
    if (!g) return x
    const w = original.get(x.wallId!)!
    const dir = wallDir(w)
    const rel = sub(x, w.a)
    const newDir = wallDir(g)
    const side = cross(dir, rel)
    const p = add(add(g.a, mul(newDir, alongAfter(w, g, dot(rel, dir)))), mul({ x: -newDir.y, y: newDir.x }, side))
    return { ...x, x: p.x, y: p.y }
  })
  return followWalls(s.walls, { ...s, walls, openings, fixtures })
}

/** Removes a wall with its openings. Fixtures on it are kept, but no longer belong to a wall. */
export function removeWall(s: Scenario, wallId: string): Scenario {
  if (!s.walls.some((w) => w.id === wallId)) return s
  return followWalls(s.walls, { ...s, walls: s.walls.filter((w) => w.id !== wallId) })
}

/** Removes a room. Its furniture stays where it stands, without a room. */
export function removeRoom(s: Scenario, roomId: string): Scenario {
  if (!s.rooms.some((r) => r.id === roomId)) return s
  return tidyReferences({ ...s, rooms: s.rooms.filter((r) => r.id !== roomId) })
}

/**
 * Replaces the walls, openings and rooms (the result of digitizing the floor plan). What stood in
 * the variant is kept and re-attached to the new geometry.
 */
export function replaceGeometry(s: Scenario, g: Pick<Scenario, 'walls' | 'openings' | 'rooms'>): Scenario {
  return tidyReferences({ ...s, walls: g.walls, openings: g.openings, rooms: g.rooms })
}
