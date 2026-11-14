import { getCatalogItem, type CatalogItem } from './catalog.ts'
import {
  add,
  clampOpening,
  closestPointOnSegment,
  dist,
  dot,
  lerp,
  lineIntersection,
  mul,
  norm,
  pointInPolygon,
  polygonCentroid,
  signedArea,
  sub,
  v,
  wallDir,
} from './geometry.ts'
import type { LoweredCeiling } from './installations.ts'
import { wallFootprint, wallRectangle } from './walls.ts'
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

/** The plain rectangle around a wall's centre line; `wallFootprint` has the corners as they are drawn. */
export function wallPolygon(w: Pick<Wall, 'a' | 'b' | 'thickness'>): Vec2[] {
  return wallRectangle(w)
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

/** How far in front of a door or a doorway the floor has to be free to walk through it. */
const PASSAGE_DEPTH = 0.6
/** A doorway with a sill this high is a hatch, not somewhere to walk. */
const PASSAGE_MAX_SILL = 0.1

/**
 * The floor that has to stay free to walk through an opening: both sides of a doorway, and the
 * side of a door its leaf does not swing over (`doorSwingPolygon` covers the other one).
 */
export function passagePolygons(o: Opening, wall: Wall): Vec2[][] {
  if (o.kind === 'window' || o.sill > PASSAGE_MAX_SILL) return []
  const { start, end } = clampOpening(o, wall)
  const d = wallDir(wall)
  const swing = doorSwingNormal(o, wall)
  const sides = o.kind === 'door' ? [mul(swing, -1)] : [swing, mul(swing, -1)]
  return sides.map((n) => {
    const p0 = add(add(wall.a, mul(d, start)), mul(n, wall.thickness / 2))
    const p1 = add(p0, mul(d, end - start))
    return [p0, p1, add(p1, mul(n, PASSAGE_DEPTH)), add(p0, mul(n, PASSAGE_DEPTH))]
  })
}

/** Something this close to the wall stands in front of the window in it. */
const WINDOW_DEPTH = 0.3
/** A sofa back or a screen may reach this far above the sill without covering the window. */
const WINDOW_SILL_MARGIN = 0.2
/** Covering less than this share of the window's width is a plant in the window, not a blocked window. */
const WINDOW_COVERED_SHARE = 0.5

/** The strip along a window, on both sides of the wall, and where the window is along the wall. */
function windowZone(o: Opening, wall: Wall): { poly: Vec2[]; start: number; end: number; z: [number, number] } | null {
  if (o.kind !== 'window') return null
  const { start, end } = clampOpening(o, wall)
  const d = wallDir(wall)
  const n = mul(v(d.y, -d.x), wall.thickness / 2 + WINDOW_DEPTH)
  const p0 = add(wall.a, mul(d, start))
  const p1 = add(wall.a, mul(d, end))
  return {
    poly: [add(p0, n), add(p1, n), sub(p1, n), sub(p0, n)],
    start,
    end,
    z: [o.sill + WINDOW_SILL_MARGIN, o.sill + o.height],
  }
}

/** How much of the stretch [start, end] along the wall the polygon covers, seen straight on. */
function coveredAlongWall(poly: Vec2[], wall: Pick<Wall, 'a' | 'b'>, start: number, end: number): number {
  const d = wallDir(wall)
  const along = poly.map((p) => dot(sub(p, wall.a), d))
  return Math.max(0, Math.min(end, Math.max(...along)) - Math.max(start, Math.min(...along)))
}

/**
 * Do two simple polygons share area? Unlike `polygonsOverlap` this also works when one of them is
 * concave (a lowered ceiling drawn around a corner). `a` is pulled `tolerance` in towards its
 * middle first, so that standing right next to `b` does not count.
 */
export function polygonsShareArea(a: Vec2[], b: Vec2[], tolerance = 0.01): boolean {
  const c = polygonCentroid(a)
  const inner = a.map((p) => {
    const l = dist(p, c)
    return l <= tolerance ? c : lerp(p, c, tolerance / l)
  })
  if (inner.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, inner))) return true
  for (let i = 0; i < inner.length; i++) {
    const p = inner[i]!
    const r = sub(inner[(i + 1) % inner.length]!, p)
    for (let j = 0; j < b.length; j++) {
      const q = b[j]!
      const hit = lineIntersection(p, r, q, sub(b[(j + 1) % b.length]!, q))
      if (hit && hit.t > 0 && hit.t < 1 && hit.u > 0 && hit.u < 1) return true
    }
  }
  return false
}

/** Vertical extent of an item, for telling floor items from wall cabinets. */
function zRange(item: FurnitureItem, cat: CatalogItem): [number, number] {
  const z0 = cat.elevation ?? 0
  return [z0, z0 + itemSize(item, cat).h]
}
const zOverlap = (a: [number, number], b: [number, number]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.01
/** A chair may be pushed in under a table or desk. */
const tucksUnder = (chair: CatalogItem, table: CatalogItem) => chair.shape === 'chair' && table.shape === 'table'

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
  /** Stands where you walk through a doorway (`of: 'opening'`), or in front of a door on the side it does not swing to. */
  | { kind: 'passage'; openingId: string; of: 'door' | 'opening' }
  /** Covers at least half of a window. */
  | { kind: 'window'; openingId: string }
  /** Reaches up into a lowered ceiling whose underside is `height` above the floor. */
  | { kind: 'ceiling'; ceilingId: string; height: number }
  | { kind: 'clearance'; side: ClearanceSide; blockedBy: { furnitureId: string } | { wallId: string } }
  | { kind: 'outside' }

/** What the checks read from a scenario. Lowered ceilings are optional, so a plain room still fits. */
export type CheckedScenario = Pick<Scenario, 'furniture' | 'walls' | 'openings' | 'rooms'> & {
  loweredCeilings?: LoweredCeiling[]
}

/**
 * Checks every item: collisions with other items and walls, free space in front/at the sides,
 * door swings, the way through doors and doorways, covered windows, lowered ceilings and whether
 * it stands inside a room.
 */
export function furnitureIssues(scenario: CheckedScenario) {
  const items = scenario.furniture.map((f) => {
    const cat = getCatalogItem(f.catalogId)
    return { f, cat, poly: footprint(f, itemSize(f, cat)), z: zRange(f, cat), zones: clearanceZones(f, cat) }
  })
  const walls = scenario.walls.map((w) => ({ w, poly: wallFootprint(w, scenario.walls) }))
  const doors = scenario.openings.flatMap((o) => {
    const wall = scenario.walls.find((w) => w.id === o.wallId)
    const poly = wall ? doorSwingPolygon(o, wall) : null
    return poly ? [{ o, poly }] : []
  })
  const passages = scenario.openings.flatMap((o) => {
    const wall = scenario.walls.find((w) => w.id === o.wallId)
    const of = o.kind === 'door' ? ('door' as const) : ('opening' as const)
    return wall ? passagePolygons(o, wall).map((poly) => ({ o, of, poly })) : []
  })
  const windows = scenario.openings.flatMap((o) => {
    const wall = scenario.walls.find((w) => w.id === o.wallId)
    const zone = wall ? windowZone(o, wall) : null
    return wall && zone ? [{ o, wall, ...zone }] : []
  })
  // Lowest first, so an item under two of them is measured against the one it meets first
  const ceilings = [...(scenario.loweredCeilings ?? [])].sort((p, q) => p.height - q.height)

  const result = new Map<string, FurnitureIssue[]>()
  for (const a of items) {
    const issues: FurnitureIssue[] = []
    const solid = a.cat.collides !== false
    const onFloor = a.z[0] < ABOVE_WALKING
    if (solid) {
      for (const b of items) {
        if (b === a || b.cat.collides === false || !zOverlap(a.z, b.z)) continue
        if (tucksUnder(a.cat, b.cat) || tucksUnder(b.cat, a.cat)) continue
        if (polygonsOverlap(a.poly, b.poly)) issues.push({ kind: 'overlap', otherId: b.f.id })
      }
      for (const { w, poly } of walls) {
        if (polygonsOverlap(a.poly, poly)) issues.push({ kind: 'wall', wallId: w.id })
      }
      if (onFloor) {
        for (const { o, poly } of doors) {
          if (polygonsOverlap(a.poly, poly, 0.02)) issues.push({ kind: 'door', openingId: o.id })
        }
        // One issue per opening, also when the item reaches through it and stands on both sides
        const blocked = new Set<string>()
        for (const { o, of, poly } of passages) {
          if (blocked.has(o.id) || !polygonsOverlap(a.poly, poly, 0.02)) continue
          blocked.add(o.id)
          issues.push({ kind: 'passage', openingId: o.id, of })
        }
      }
      for (const win of windows) {
        if (!zOverlap(a.z, win.z) || !polygonsOverlap(a.poly, win.poly, 0.02)) continue
        const covered = coveredAlongWall(a.poly, win.wall, win.start, win.end)
        if (covered >= (win.end - win.start) * WINDOW_COVERED_SHARE)
          issues.push({ kind: 'window', openingId: win.o.id })
      }
    }
    const low = ceilings.find((c) => a.z[1] > c.height + 0.005 && polygonsShareArea(a.poly, c.polygon))
    if (low) issues.push({ kind: 'ceiling', ceilingId: low.id, height: low.height })
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
/** Which side of the plan a room edge is on, judged by the direction it faces into the room. */
export type PlanSide = 'top' | 'right' | 'bottom' | 'left'

function sideOf(inward: Vec2): PlanSide | null {
  if (inward.y > 0.7) return 'top'
  if (inward.y < -0.7) return 'bottom'
  if (inward.x > 0.7) return 'left'
  if (inward.x < -0.7) return 'right'
  return null
}

/** The room's edges (inside faces of its walls) with their plan side and inward normal. */
export function roomEdges(poly: Vec2[]): { a: Vec2; b: Vec2; length: number; inward: Vec2; side: PlanSide | null }[] {
  const ccw = signedArea(poly) > 0
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    const dir = norm(sub(b, a))
    const inward = ccw ? v(-dir.y, dir.x) : v(dir.y, -dir.x)
    return { a, b, length: dist(a, b), inward, side: sideOf(inward) }
  })
}

function wallCandidates(poly: Vec2[], size: Size, preferSide?: PlanSide): Placement[] {
  const edges = roomEdges(poly)
  // Edges on the preferred side first, longest first within each group
  const ordered = [...edges].sort(
    (e1, e2) => Number(e2.side === preferSide) - Number(e1.side === preferSide) || e2.length - e1.length,
  )
  const out: Placement[] = []
  for (const { a, b, length: L, inward: n } of ordered) {
    if (L < size.w + 0.02) continue
    const dir = norm(sub(b, a))
    const rotation = (Math.atan2(-n.x, n.y) * 180) / Math.PI
    // Middle of the wall first, then outwards
    const ts: number[] = []
    for (let t = size.w / 2 + 0.01; t <= L - size.w / 2 - 0.01; t += 0.1) ts.push(t)
    ts.sort((t1, t2) => Math.abs(t1 - L / 2) - Math.abs(t2 - L / 2))
    for (const t of ts) {
      const p = add(add(a, mul(dir, t)), mul(n, size.d / 2 + 0.003))
      out.push({ x: p.x, y: p.y, rotation })
    }
  }
  return out
}

/**
 * Seats at the tables and desks in a room: in front of and behind each (two per side on wide
 * tables), pushed slightly in and facing the table.
 */
function tableCandidates(furniture: FurnitureItem[], roomId: string, chair: Size): Placement[] {
  const out: Placement[] = []
  for (const t of furniture) {
    const tcat = getCatalogItem(t.catalogId)
    if (t.roomId !== roomId || tcat.shape !== 'table' || tcat.allowInClearance) continue
    const { w, d } = itemSize(t, tcat)
    const along = w >= 1.2 ? [-w / 4, w / 4] : [0]
    const out_ = d / 2 + chair.d / 2 - 0.15
    for (const [ly, rot] of [
      [out_, t.rotation + 180],
      [-out_, t.rotation],
    ] as const) {
      for (const lx of along) {
        const p = toWorld(t, v(lx, ly))
        out.push({ x: p.x, y: p.y, rotation: ((rot % 360) + 360) % 360 })
      }
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
  scenario: CheckedScenario,
  catalogId: string,
  room: Room,
  opts: { size?: Size | null; preferSide?: PlanSide; freeStanding?: boolean } = {},
): Placement | null {
  if (room.polygon.length < 3) return null
  const cat = getCatalogItem(catalogId)
  const size = opts.size ?? { w: cat.w, d: cat.d, h: cat.h }
  const freeStanding = opts.freeStanding ?? FREE_STANDING.has(cat.shape)
  const base = freeStanding
    ? floorCandidates(room.polygon)
    : [...wallCandidates(room.polygon, size, opts.preferSide), ...floorCandidates(room.polygon)]
  const candidates = cat.shape === 'chair' ? [...tableCandidates(scenario.furniture, room.id, size), ...base] : base
  // The new item must not make things worse for what is already there either
  const before = furnitureIssues(scenario)
  const countOf = (m: Map<string, FurnitureIssue[]>, id: string) => m.get(id)?.length ?? 0
  for (const p of candidates) {
    const probe: FurnitureItem = {
      id: '__probe__',
      catalogId,
      ...p,
      roomId: room.id,
      size: opts.size ?? null,
      label: null,
    }
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
    case 'passage':
      return issue.of === 'door' ? 'Står i veien foran en dør' : 'Står i veien i en åpning mellom rom'
    case 'window':
      return 'Dekker mer enn halve vinduet'
    case 'ceiling':
      return `Rekker opp i nedforet tak (${Math.round(issue.height * 100)} cm over gulvet)`
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
