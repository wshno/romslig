import { getCatalogItem, type CatalogItem } from './catalog.ts'
import {
  add,
  clampOpening,
  closestPointOnSegment,
  dist,
  dot,
  mul,
  norm,
  pointInPolygon,
  polygonCentroid,
  signedArea,
  sub,
  v,
  wallDir,
} from './geometry.ts'
import type { FurnitureItem, Opening, Room, Scenario, Vec2, Wall } from './model.ts'

export interface Size {
  w: number
  d: number
  h: number
}

export function itemSize(item: FurnitureItem, cat: CatalogItem = getCatalogItem(item.catalogId)): Size {
  return item.size ?? { w: cat.w, d: cat.d, h: cat.h }
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Local (x along width, y along depth, +y = front) → plan coordinates. */
export function toWorld(item: Pick<FurnitureItem, 'x' | 'y' | 'rotation'>, local: Vec2): Vec2 {
  const c = Math.cos(rad(item.rotation))
  const s = Math.sin(rad(item.rotation))
  return v(item.x + local.x * c - local.y * s, item.y + local.x * s + local.y * c)
}

/** Unit vector the item's front faces. */
export function frontDir(rotation: number): Vec2 {
  return v(-Math.sin(rad(rotation)), Math.cos(rad(rotation)))
}

/** Corners of an axis-aligned local rectangle [x0,x1]×[y0,y1], in plan coordinates. */
export function localRect(
  item: Pick<FurnitureItem, 'x' | 'y' | 'rotation'>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Vec2[] {
  return [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)].map((p) => toWorld(item, p))
}

export function footprint(item: FurnitureItem, size: Size = itemSize(item)): Vec2[] {
  return localRect(item, -size.w / 2, -size.d / 2, size.w / 2, size.d / 2)
}

export type ClearanceSide = 'front' | 'back' | 'left' | 'right'

/** The free-space zones an item needs, as plan polygons. */
export function clearanceZones(
  item: FurnitureItem,
  cat: CatalogItem = getCatalogItem(item.catalogId),
): { side: ClearanceSide; poly: Vec2[] }[] {
  const { w, d } = itemSize(item, cat)
  const { front, back, sides } = cat.clearance
  const out: { side: ClearanceSide; poly: Vec2[] }[] = []
  if (front > 0) out.push({ side: 'front', poly: localRect(item, -w / 2, d / 2, w / 2, d / 2 + front) })
  if (back > 0) out.push({ side: 'back', poly: localRect(item, -w / 2, -d / 2 - back, w / 2, -d / 2) })
  if (sides > 0) {
    out.push({ side: 'left', poly: localRect(item, -w / 2 - sides, -d / 2, -w / 2, d / 2) })
    out.push({ side: 'right', poly: localRect(item, w / 2, -d / 2, w / 2 + sides, d / 2) })
  }
  return out
}

/**
 * Separating axis test for convex polygons. Shapes count as overlapping only when they
 * penetrate by more than `tolerance` (touching, e.g. a cabinet against a wall, is fine).
 */
export function polygonsOverlap(a: Vec2[], b: Vec2[], tolerance = 0.01): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!
      const q = poly[(i + 1) % poly.length]!
      const axis = norm(v(-(q.y - p.y), q.x - p.x))
      let [minA, maxA, minB, maxB] = [Infinity, -Infinity, Infinity, -Infinity]
      for (const pt of a) {
        const t = dot(pt, axis)
        minA = Math.min(minA, t)
        maxA = Math.max(maxA, t)
      }
      for (const pt of b) {
        const t = dot(pt, axis)
        minB = Math.min(minB, t)
        maxB = Math.max(maxB, t)
      }
      if (Math.min(maxA, maxB) - Math.max(minA, minB) <= tolerance) return false
    }
  }
  return true
}

export function wallPolygon(w: Pick<Wall, 'a' | 'b' | 'thickness'>): Vec2[] {
  const d = wallDir(w)
  const n = v(-d.y * (w.thickness / 2), d.x * (w.thickness / 2))
  return [add(w.a, n), add(w.b, n), sub(w.b, n), sub(w.a, n)]
}

/** Unit normal pointing to the side of the wall a door swings into. */
export function doorSwingNormal(o: Pick<Opening, 'flip'>, wall: Pick<Wall, 'a' | 'b'>): Vec2 {
  const d = wallDir(wall)
  const n = v(d.y, -d.x)
  return o.flip ? mul(n, -1) : n
}

/** The square a door leaf sweeps through, on its swing side. */
export function doorSwingPolygon(o: Opening, wall: Wall): Vec2[] | null {
  if (o.kind !== 'door') return null
  const { start, end } = clampOpening(o, wall)
  const d = wallDir(wall)
  const n = doorSwingNormal(o, wall)
  const width = end - start
  const p0 = add(add(wall.a, mul(d, start)), mul(n, wall.thickness / 2))
  const p1 = add(p0, mul(d, width))
  return [p0, p1, add(p1, mul(n, width)), add(p0, mul(n, width))]
}

/** Vertical extent of an item, for telling floor items from wall cabinets. */
function zRange(item: FurnitureItem, cat: CatalogItem): [number, number] {
  const z0 = cat.elevation ?? 0
  return [z0, z0 + itemSize(item, cat).h]
}
const zOverlap = (a: [number, number], b: [number, number]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.01
/** Things at least this high off the floor don't block walking space. */
const ABOVE_WALKING = 1.2

/**
 * Pushes an item back against the nearest wall, facing into the room, if its back edge is within
 * `maxGap` of a wall face. Keeps the position along the wall.
 */
export function snapToWall(
  p: Vec2,
  size: Pick<Size, 'd'>,
  walls: Wall[],
  maxGap = 0.3,
): { x: number; y: number; rotation: number; wallId: string } | null {
  let best: { x: number; y: number; rotation: number; wallId: string; gap: number } | null = null
  for (const w of walls) {
    const c = closestPointOnSegment(p, w.a, w.b)
    if (c.t <= 0 || c.t >= 1) continue
    const gap = c.dist - w.thickness / 2 - size.d / 2
    if (gap > maxGap || gap < -size.d) continue
    const n = norm(sub(p, c.point))
    if (n.x === 0 && n.y === 0) continue
    const at = add(c.point, mul(n, w.thickness / 2 + size.d / 2 + 0.002))
    const rotation = (Math.atan2(-n.x, n.y) * 180) / Math.PI
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { x: at.x, y: at.y, rotation, wallId: w.id, gap }
  }
  if (!best) return null
  return { x: best.x, y: best.y, rotation: best.rotation, wallId: best.wallId }
}

export function roomAt(p: Vec2, rooms: Room[]): Room | null {
  return rooms.find((r) => r.polygon.length >= 3 && pointInPolygon(p, r.polygon)) ?? null
}

export type FurnitureIssue =
  | { kind: 'overlap'; otherId: string }
  | { kind: 'wall'; wallId: string }
  | { kind: 'door'; openingId: string }
  | { kind: 'clearance'; side: ClearanceSide; blockedBy: { furnitureId: string } | { wallId: string } }
  | { kind: 'outside' }

/**
 * Checks every item: collisions with other items and walls, free space in front/at the sides,
 * door swings and whether it stands inside a room.
 */
export function furnitureIssues(scenario: Pick<Scenario, 'furniture' | 'walls' | 'openings' | 'rooms'>) {
  const items = scenario.furniture.map((f) => {
    const cat = getCatalogItem(f.catalogId)
    return { f, cat, poly: footprint(f, itemSize(f, cat)), z: zRange(f, cat), zones: clearanceZones(f, cat) }
  })
  const walls = scenario.walls.map((w) => ({ w, poly: wallPolygon(w) }))
  const doors = scenario.openings.flatMap((o) => {
    const wall = scenario.walls.find((w) => w.id === o.wallId)
    const poly = wall ? doorSwingPolygon(o, wall) : null
    return poly ? [{ o, poly }] : []
  })

  const result = new Map<string, FurnitureIssue[]>()
  for (const a of items) {
    const issues: FurnitureIssue[] = []
    const solid = a.cat.collides !== false
    const onFloor = a.z[0] < ABOVE_WALKING
    if (solid) {
      for (const b of items) {
        if (b === a || b.cat.collides === false || !zOverlap(a.z, b.z)) continue
        if (polygonsOverlap(a.poly, b.poly)) issues.push({ kind: 'overlap', otherId: b.f.id })
      }
      for (const { w, poly } of walls) {
        if (polygonsOverlap(a.poly, poly)) issues.push({ kind: 'wall', wallId: w.id })
      }
      if (onFloor) {
        for (const { o, poly } of doors) {
          if (polygonsOverlap(a.poly, poly, 0.02)) issues.push({ kind: 'door', openingId: o.id })
        }
      }
    }
    if (onFloor) {
      for (const zone of a.zones) {
        const wall = walls.find(({ poly }) => polygonsOverlap(zone.poly, poly))
        if (wall) {
          issues.push({ kind: 'clearance', side: zone.side, blockedBy: { wallId: wall.w.id } })
          continue
        }
        const other = items.find(
          (b) =>
            b !== a &&
            b.cat.collides !== false &&
            !b.cat.allowInClearance &&
            b.z[0] < ABOVE_WALKING &&
            polygonsOverlap(zone.poly, b.poly),
        )
        if (other) issues.push({ kind: 'clearance', side: zone.side, blockedBy: { furnitureId: other.f.id } })
      }
    }
    if (scenario.rooms.length > 0 && !roomAt(v(a.f.x, a.f.y), scenario.rooms)) issues.push({ kind: 'outside' })
    if (issues.length) result.set(a.f.id, issues)
  }
  return result
}

/** Items that belong in the open floor rather than against a wall. */
const FREE_STANDING = new Set(['table', 'rug', 'chair'])

type Placement = { x: number; y: number; rotation: number }

/** Candidate spots along the inside of the room's walls, backs against the wall, facing in. */
function wallCandidates(poly: Vec2[], size: Size): Placement[] {
  const ccw = signedArea(poly) > 0
  const out: Placement[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const L = dist(a, b)
    if (L < size.w + 0.02) continue
    const dir = norm(sub(b, a))
    const n = ccw ? v(-dir.y, dir.x) : v(dir.y, -dir.x)
    const rotation = (Math.atan2(-n.x, n.y) * 180) / Math.PI
    for (let t = size.w / 2 + 0.01; t <= L - size.w / 2 - 0.01; t += 0.1) {
      const p = add(add(a, mul(dir, t)), mul(n, size.d / 2 + 0.003))
      out.push({ x: p.x, y: p.y, rotation })
    }
  }
  return out
}

/** Candidate spots on a grid inside the room, nearest the middle first. */
function floorCandidates(poly: Vec2[]): Placement[] {
  const c = polygonCentroid(poly)
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const out: Placement[] = []
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.2) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.2) {
      if (pointInPolygon(v(x, y), poly)) out.push({ x, y, rotation: 0 })
    }
  }
  return [{ ...c, rotation: 0 }, ...out.sort((p, q) => dist(p, c) - dist(q, c))]
}

/**
 * Finds a spot in a room where a new item has no problems (no collisions, enough free space,
 * clear of door swings). Wall-standing items are tried along the walls, tables and rugs in the
 * open floor. Returns null if nothing fits.
 */
export function findFreeSpot(
  scenario: Pick<Scenario, 'furniture' | 'walls' | 'openings' | 'rooms'>,
  catalogId: string,
  room: Room,
): Placement | null {
  if (room.polygon.length < 3) return null
  const cat = getCatalogItem(catalogId)
  const size = { w: cat.w, d: cat.d, h: cat.h }
  const candidates = FREE_STANDING.has(cat.shape)
    ? floorCandidates(room.polygon)
    : [...wallCandidates(room.polygon, size), ...floorCandidates(room.polygon)]
  // The new item must not make things worse for what is already there either
  const before = furnitureIssues(scenario)
  const countOf = (m: Map<string, FurnitureIssue[]>, id: string) => m.get(id)?.length ?? 0
  for (const p of candidates) {
    const probe: FurnitureItem = { id: '__probe__', catalogId, ...p, roomId: room.id, size: null, label: null }
    const after = furnitureIssues({ ...scenario, furniture: [...scenario.furniture, probe] })
    if (after.has(probe.id)) continue
    if (scenario.furniture.every((f) => countOf(after, f.id) <= countOf(before, f.id))) return p
  }
  return null
}

const SIDE_LABELS = { front: 'foran', back: 'bak', left: 'til venstre', right: 'til høyre' } as const

/** Human-readable (Norwegian) description of an issue. */
export function describeFurnitureIssue(
  issue: FurnitureIssue,
  scenario: Pick<Scenario, 'furniture'>,
  itemCatalogId: string,
): string {
  const nameOf = (id: string) => {
    const f = scenario.furniture.find((x) => x.id === id)
    return f ? (f.label ?? getCatalogItem(f.catalogId).name) : 'et møbel'
  }
  switch (issue.kind) {
    case 'overlap':
      return `Kolliderer med «${nameOf(issue.otherId)}»`
    case 'wall':
      return 'Står inni en vegg'
    case 'door':
      return 'Står i slagfeltet til en dør'
    case 'outside':
      return 'Står utenfor rommene'
    case 'clearance': {
      const c = getCatalogItem(itemCatalogId).clearance
      const need = { front: c.front, back: c.back, left: c.sides, right: c.sides }[issue.side]
      const by = 'wallId' in issue.blockedBy ? 'en vegg' : `«${nameOf(issue.blockedBy.furnitureId)}»`
      return `For lite fri plass ${SIDE_LABELS[issue.side]} (trenger ${Math.round(need * 100)} cm), blokkert av ${by}`
    }
  }
}
