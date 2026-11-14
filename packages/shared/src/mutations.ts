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
import { WALL_JOIN_TOLERANCE } from './walls.ts'
import { newId, type Opening, type Room, type Scenario, type Vec2, type Wall } from './model.ts'

/**
 * Edits to a variant that keep it consistent: connected walls stay connected, openings and
 * wall-mounted fixtures stay where they were on their wall, rooms follow the walls they are bounded
 * by, and nothing is left pointing at a wall or room that no longer exists.
 *
 * All functions are pure: they return a new scenario and leave the one they were given untouched.
 */

/** Endpoints closer than this are the same corner (m). */
const JOIN_EPS = WALL_JOIN_TOLERANCE

export type WallEnd = 'a' | 'b'
const ENDS: readonly WallEnd[] = ['a', 'b']
const leftOf = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x })
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
  /** Endpoints that sit in a moving corner (the wall's own end included); `corner` is its index in the list of moving ends. */
  corner: { id: string; end: WallEnd; corner: number }[]
  /** Endpoints that butt against the side of a wall that moves, in the order they were found. */
  butting: { id: string; end: WallEnd; hostId: string; along: number }[]
}

/** What comes along when these wall ends move: the walls in each corner, and the walls standing against any wall that moves. */
function attachmentsOf(s: Scenario, ends: { wallId: string; end: WallEnd }[]): Attachment | null {
  const own = ends.map(({ wallId }) => s.walls.find((w) => w.id === wallId))
  if (own.some((w) => !w)) return null
  const corner: Attachment['corner'] = []
  const taken = new Set<string>()
  ends.forEach(({ wallId, end }, i) => {
    const from = own[i]![end]
    for (const w of s.walls)
      for (const e of ENDS) {
        const key = `${w.id}:${e}`
        if (taken.has(key)) continue
        const moving = ends.find((x) => x.wallId === w.id && x.end === e)
        if (moving ? moving.wallId !== wallId || moving.end !== end : dist(w[e], from) >= JOIN_EPS) continue
        taken.add(key)
        corner.push({ id: w.id, end: e, corner: i })
      }
  })
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

const attachments = (s: Scenario, wallId: string, end: WallEnd) => attachmentsOf(s, [{ wallId, end }])
const bothEnds = (s: Scenario, wallId: string) =>
  attachmentsOf(
    s,
    [...ENDS].map((end) => ({ wallId, end })),
  )
const movedIds = (at: Attachment | null) => (at ? [...new Set([...at.corner, ...at.butting].map((x) => x.id))] : [])

/** The walls that change when this end of the wall is moved (the wall itself included). */
export function wallsMovedWith(s: Scenario, wallId: string, end: WallEnd): string[] {
  return movedIds(attachments(s, wallId, end))
}

/** The walls that change when the whole wall is moved with moveWall (the wall itself included). */
export function wallsMovedWithWall(s: Scenario, wallId: string): string[] {
  return movedIds(bothEnds(s, wallId))
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
 * Moves every corner of `at` to its target (`targets[i]` for corner i), lets the walls standing
 * against a moving wall follow, and carries openings, wall-mounted fixtures and rooms along.
 * `alongOf` overrides, per wall, where a point `along` metres from its start ends up (by default
 * it keeps its distance from the end that stands still, see alongAfter).
 */
function moveCorners(
  s: Scenario,
  at: Attachment,
  targets: Vec2[],
  alongOf: ReadonlyMap<string, (along: number) => number> = new Map(),
): Scenario {
  const original = new Map(s.walls.map((w) => [w.id, w]))
  const moved = new Map<string, Segment>()
  const current = (id: string): Segment => moved.get(id) ?? original.get(id)!
  const setEnd = (id: string, e: WallEnd, p: Vec2) => moved.set(id, { ...current(id), [e]: p })

  for (const c of at.corner) setEnd(c.id, c.end, targets[c.corner]!)
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

  const after = (id: string, g: Segment, along: number) =>
    alongOf.get(id)?.(along) ?? alongAfter(original.get(id)!, g, along)
  const walls = s.walls.map((w) => (moved.has(w.id) ? { ...w, ...moved.get(w.id)! } : w))
  const openings = s.openings.map((o): Opening => {
    const g = moved.get(o.wallId)
    return g ? { ...o, offset: after(o.wallId, g, o.offset) } : o
  })
  const fixtures = s.fixtures.map((x) => {
    const g = x.wallId ? moved.get(x.wallId) : undefined
    if (!g) return x
    const w = original.get(x.wallId!)!
    const dir = wallDir(w)
    const rel = sub(x, w.a)
    const newDir = wallDir(g)
    const side = cross(dir, rel)
    const p = add(add(g.a, mul(newDir, after(w.id, g, dot(rel, dir)))), mul(leftOf(newDir), side))
    return { ...x, x: p.x, y: p.y }
  })
  return followWalls(s.walls, { ...s, walls, openings, fixtures })
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
  return at ? moveCorners(s, at, [to]) : s
}

/** The wall whose side (not one of its ends) this end of `wall` stands against, if any. */
function hostOf(s: Scenario, wall: Wall, end: WallEnd): Wall | undefined {
  let best: { w: Wall; d: number } | undefined
  for (const o of s.walls) {
    if (o.id === wall.id) continue
    const length = wallLength(o)
    const c = closestPointOnSegment(wall[end], o.a, o.b)
    const along = c.t * length
    if (c.dist > JOIN_EPS || along < JOIN_EPS || length - along < JOIN_EPS) continue
    if (!best || c.dist < best.d) best = { w: o, d: c.dist }
  }
  return best?.w
}

/**
 * Moves a wall parallel to itself, `offset` metres along its left normal (positive = to the left
 * when looking from a to b).
 * - Walls that meet it in a corner have that end moved along, so they get longer or shorter and
 *   the corner stays closed.
 * - Walls that stand against its side (or against the side of a corner wall that changes) are made
 *   longer or shorter in their own direction so they keep touching it, as in moveWallEndpoint.
 * - Where an end of the wall stands against the side of another wall, that end slides along the
 *   other wall's line, so the wall keeps touching it and stays parallel to where it was (moved far
 *   enough, the end can pass the other wall's end).
 * - Openings and fixtures on the wall keep their place along it; rooms follow (followWalls).
 *
 * Meant to be applied to the scenario as it was when the drag started, like moveWallEndpoint.
 */
export function moveWall(s: Scenario, wallId: string, offset: number): Scenario {
  const w = s.walls.find((x) => x.id === wallId)
  if (!w || !Number.isFinite(offset) || offset === 0 || wallLength(w) < 1e-9) return s
  const at = bothEnds(s, wallId)
  if (!at) return s
  const dir = wallDir(w)
  const shift = mul(leftOf(dir), offset)
  const targets = ENDS.map((end) => {
    const p = add(w[end], shift)
    const host = hostOf(s, w, end)
    const hit = host ? lineIntersection(p, dir, host.a, sub(host.b, host.a)) : null
    return hit ? add(p, mul(dir, hit.t)) : p
  })
  // Things on the wall stay where they were along it, also when its start slid along a host
  const slid = dot(sub(targets[0]!, add(w.a, shift)), dir)
  return moveCorners(s, at, targets, new Map([[wallId, (along: number) => along - slid]]))
}

/**
 * Splits a wall in two at `at` metres from its end a. The first piece keeps the wall's id (so a
 * selection stays on it), the second gets `newWallId`; both keep the wall's properties and meet at
 * the split point. Openings and wall-mounted fixtures go to the piece they are on.
 *
 * A split that falls inside an opening is moved to the opening's nearest edge, so a door stays
 * whole. Nothing changes (the scenario is returned as it was) when that would leave a piece shorter
 * than MIN_WALL_LENGTH, or when the split still falls inside an opening (overlapping openings).
 */
export function splitWall(s: Scenario, wallId: string, at: number, newWallId: string = newId('w_')): Scenario {
  const w = s.walls.find((x) => x.id === wallId)
  if (!w || !Number.isFinite(at)) return s
  const length = wallLength(w)
  const openings = s.openings.filter((o) => o.wallId === wallId)
  const inside = (cut: number) =>
    openings.find((o) => o.offset - o.width / 2 < cut - 1e-6 && o.offset + o.width / 2 > cut + 1e-6)
  let cut = at
  const hit = inside(cut)
  if (hit) {
    const start = hit.offset - hit.width / 2
    const end = hit.offset + hit.width / 2
    cut = cut - start <= end - cut ? start : end
    if (inside(cut)) return s
  }
  if (cut < MIN_WALL_LENGTH || length - cut < MIN_WALL_LENGTH) return s

  const p = pointAlong(w, cut)
  const dir = wallDir(w)
  const first: Wall = { ...w, b: p }
  const second: Wall = { ...w, id: newWallId, a: p }
  return followWalls(s.walls, {
    ...s,
    walls: s.walls.flatMap((x) => (x.id === wallId ? [first, second] : [x])),
    openings: s.openings.map((o) =>
      o.wallId === wallId && o.offset > cut ? { ...o, wallId: newWallId, offset: o.offset - cut } : o,
    ),
    fixtures: s.fixtures.map((x) =>
      x.wallId === wallId && dot(sub(x, w.a), dir) > cut ? { ...x, wallId: newWallId } : x,
    ),
  })
}

/** The shortest wall setWallLength makes. */
export const MIN_WALL_LENGTH = 0.05

/**
 * Makes a wall `length` long by moving one end along the wall's own direction; `keep` is the end
 * that stays. Everything attached to the moving end comes along, as when it is dragged
 * (moveWallEndpoint).
 */
export function setWallLength(s: Scenario, wallId: string, length: number, keep: WallEnd = 'a'): Scenario {
  const w = s.walls.find((x) => x.id === wallId)
  if (!w || !Number.isFinite(length) || length <= 0 || dist(w.a, w.b) < 1e-9) return s
  const from = keep === 'a' ? w.a : w.b
  const toward = keep === 'a' ? w.b : w.a
  const to = add(from, mul(norm(sub(toward, from)), Math.max(MIN_WALL_LENGTH, length)))
  return moveWallEndpoint(s, wallId, keep === 'a' ? 'b' : 'a', to)
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
