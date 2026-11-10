import type { Opening, Room, Vec2, Wall } from './model.ts'

export const v = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x
export const len = (a: Vec2) => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)
export const norm = (a: Vec2): Vec2 => {
  const l = len(a)
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

export const wallLength = (w: Pick<Wall, 'a' | 'b'>) => dist(w.a, w.b)
export const wallDir = (w: Pick<Wall, 'a' | 'b'>) => norm(sub(w.b, w.a))

/** Signed shoelace area. Positive = counter-clockwise in a y-up frame. */
export function signedArea(poly: Vec2[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    s += p.x * q.y - q.x * p.y
  }
  return s / 2
}
export const polygonArea = (poly: Vec2[]) => Math.abs(signedArea(poly))

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly)
  if (Math.abs(a) < 1e-9) {
    const s = poly.reduce((acc, p) => add(acc, p), v(0, 0))
    return mul(s, 1 / Math.max(1, poly.length))
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return v(cx / (6 * a), cy / (6 * a))
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2))
  const point = lerp(a, b, t)
  return { point, t, dist: dist(p, point) }
}

/** Intersection of infinite lines (p, p+r) and (q, q+s). Returns params t (on first) and u (on second). */
export function lineIntersection(p: Vec2, r: Vec2, q: Vec2, s: Vec2): { t: number; u: number } | null {
  const d = cross(r, s)
  if (Math.abs(d) < 1e-12) return null
  const qp = sub(q, p)
  return { t: cross(qp, s) / d, u: cross(qp, r) / d }
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

export type SnapKind = 'endpoint' | 'wall' | 'angle' | 'none'

export function snapPoint(
  p: Vec2,
  opts: { walls: Wall[]; anchor?: Vec2 | null; tolerance: number; ortho?: boolean; excludeWallId?: string },
): { point: Vec2; kind: SnapKind } {
  const walls = opts.walls.filter((w) => w.id !== opts.excludeWallId)
  // 1. Endpoints
  let best: { point: Vec2; d: number } | null = null
  for (const w of walls) {
    for (const e of [w.a, w.b]) {
      const d = dist(p, e)
      if (d < opts.tolerance && (!best || d < best.d)) best = { point: e, d }
    }
  }
  if (best) return { point: { ...best.point }, kind: 'endpoint' }

  // 2. Angle snapping relative to anchor (45° increments)
  if (opts.anchor && opts.ortho) {
    const d = sub(p, opts.anchor)
    const r = len(d)
    if (r > 1e-6) {
      const step = Math.PI / 4
      const ang = Math.round(Math.atan2(d.y, d.x) / step) * step
      const dir = v(Math.cos(ang), Math.sin(ang))
      const q = add(opts.anchor, mul(dir, dot(d, dir)))
      // Prefer where the snapped ray hits an existing wall
      let hit: { point: Vec2; d: number } | null = null
      for (const w of walls) {
        const ix = lineIntersection(opts.anchor, dir, w.a, sub(w.b, w.a))
        if (!ix || ix.u < -1e-6 || ix.u > 1 + 1e-6 || ix.t <= 0) continue
        const pt = add(opts.anchor, mul(dir, ix.t))
        const dd = dist(pt, q)
        if (dd < opts.tolerance && (!hit || dd < hit.d)) hit = { point: pt, d: dd }
      }
      if (hit) return { point: hit.point, kind: 'wall' }
      return { point: q, kind: 'angle' }
    }
  }

  // 3. Nearest point on a wall
  let seg: { point: Vec2; d: number } | null = null
  for (const w of walls) {
    const c = closestPointOnSegment(p, w.a, w.b)
    if (c.dist < opts.tolerance && (!seg || c.dist < seg.d)) seg = { point: c.point, d: c.dist }
  }
  if (seg) return { point: seg.point, kind: 'wall' }
  return { point: p, kind: 'none' }
}

// ---------------------------------------------------------------------------
// Openings → wall pieces (for 3D extrusion)
// ---------------------------------------------------------------------------

export interface WallPiece {
  /** Distance along the wall from wall.a */
  s0: number
  s1: number
  /** Height range */
  z0: number
  z1: number
}

/**
 * The opening as it fits in its wall: no wider than the wall, and inside it from end to end.
 * Returns the same object when it already fits.
 */
export function fitOpening<T extends Pick<Opening, 'offset' | 'width'>>(o: T, wall: Pick<Wall, 'a' | 'b'>): T {
  const L = wallLength(wall)
  if (L <= 0) return o
  const width = Math.min(o.width, L)
  const offset = Math.max(width / 2, Math.min(L - width / 2, o.offset))
  return width === o.width && offset === o.offset ? o : { ...o, width, offset }
}

export function clampOpening(o: Opening, wall: Wall): { start: number; end: number } {
  const { offset, width } = fitOpening(o, wall)
  return { start: offset - width / 2, end: offset + width / 2 }
}

export function wallPieces(wall: Wall, openings: Opening[]): WallPiece[] {
  const L = wallLength(wall)
  const H = wall.height
  const ops = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({ o, ...clampOpening(o, wall) }))
    .sort((a, b) => a.start - b.start)
  const pieces: WallPiece[] = []
  let cursor = 0
  for (const { o, start, end } of ops) {
    const s = Math.max(start, cursor)
    if (s > cursor + 1e-6) pieces.push({ s0: cursor, s1: s, z0: 0, z1: H })
    if (end > s + 1e-6) {
      if (o.sill > 1e-6) pieces.push({ s0: s, s1: end, z0: 0, z1: Math.min(o.sill, H) })
      const top = o.sill + o.height
      if (top < H - 1e-6) pieces.push({ s0: s, s1: end, z0: top, z1: H })
    }
    cursor = Math.max(cursor, end)
  }
  if (cursor < L - 1e-6) pieces.push({ s0: cursor, s1: L, z0: 0, z1: H })
  return pieces
}

// ---------------------------------------------------------------------------
// Room detection: planar faces of the wall graph, inset by half wall thickness
// ---------------------------------------------------------------------------

interface GEdge {
  u: number
  v: number
  thickness: number
}

/**
 * Finds enclosed regions formed by walls. Returns room polygons measured to the
 * inside face of the walls (so the area is comparable with the m² on a floor plan).
 */
export function detectRoomPolygons(walls: Wall[], opts: { eps?: number; minArea?: number } = {}): Vec2[][] {
  const eps = opts.eps ?? 0.03
  const minArea = opts.minArea ?? 0.4
  if (walls.length < 3) return []

  // 1. Split walls at T-junctions and crossings
  const pieces: { a: Vec2; b: Vec2; thickness: number }[] = []
  for (const w of walls) {
    const ts: number[] = [0, 1]
    const d = sub(w.b, w.a)
    const L = len(d)
    if (L < eps) continue
    for (const o of walls) {
      if (o === w) continue
      for (const e of [o.a, o.b]) {
        const c = closestPointOnSegment(e, w.a, w.b)
        if (c.dist < eps && c.t * L > eps && (1 - c.t) * L > eps) ts.push(c.t)
      }
      const ix = lineIntersection(w.a, d, o.a, sub(o.b, o.a))
      if (ix && ix.t * L > eps && (1 - ix.t) * L > eps && ix.u > 1e-6 && ix.u < 1 - 1e-6) ts.push(ix.t)
    }
    ts.sort((x, y) => x - y)
    for (let i = 0; i < ts.length - 1; i++) {
      if ((ts[i + 1]! - ts[i]!) * L < eps) continue
      pieces.push({ a: lerp(w.a, w.b, ts[i]!), b: lerp(w.a, w.b, ts[i + 1]!), thickness: w.thickness })
    }
  }

  // 2. Merge nearby points into nodes
  const nodes: Vec2[] = []
  const nodeOf = (p: Vec2): number => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i]!, p) < eps) return i
    nodes.push({ ...p })
    return nodes.length - 1
  }
  const edgeMap = new Map<string, GEdge>()
  for (const p of pieces) {
    const u = nodeOf(p.a)
    const w = nodeOf(p.b)
    if (u === w) continue
    const key = u < w ? `${u}-${w}` : `${w}-${u}`
    const prev = edgeMap.get(key)
    if (!prev || prev.thickness < p.thickness) edgeMap.set(key, { u, v: w, thickness: p.thickness })
  }

  // 3. Adjacency, pruning dangling edges
  const adj = new Map<number, Set<number>>()
  const thick = new Map<string, number>()
  for (const e of edgeMap.values()) {
    if (!adj.has(e.u)) adj.set(e.u, new Set())
    if (!adj.has(e.v)) adj.set(e.v, new Set())
    adj.get(e.u)!.add(e.v)
    adj.get(e.v)!.add(e.u)
    thick.set(`${e.u}-${e.v}`, e.thickness)
    thick.set(`${e.v}-${e.u}`, e.thickness)
  }
  let pruned = true
  while (pruned) {
    pruned = false
    for (const [n, s] of adj) {
      if (s.size <= 1) {
        for (const m of s) adj.get(m)?.delete(n)
        adj.delete(n)
        pruned = true
      }
    }
  }

  // 4. Trace faces: at each node take the next neighbour counter-clockwise from the incoming edge
  const angle = (from: number, to: number) => Math.atan2(nodes[to]!.y - nodes[from]!.y, nodes[to]!.x - nodes[from]!.x)
  const visited = new Set<string>()
  const faces: number[][] = []
  for (const [u, nbrs] of adj) {
    for (const w of nbrs) {
      if (visited.has(`${u}-${w}`)) continue
      const face: number[] = []
      let a = u
      let b = w
      let guard = 0
      while (!visited.has(`${a}-${b}`) && guard++ < 10000) {
        visited.add(`${a}-${b}`)
        face.push(a)
        const back = angle(b, a)
        let best = -1
        let bestDelta = Infinity
        for (const c of adj.get(b)!) {
          if (c === a && adj.get(b)!.size > 1) continue
          let delta = angle(b, c) - back
          while (delta <= 1e-9) delta += Math.PI * 2
          if (delta < bestDelta) {
            bestDelta = delta
            best = c
          }
        }
        a = b
        b = best
      }
      if (face.length >= 3) faces.push(face)
    }
  }

  // 5. Keep inner faces (negative signed area with this traversal), inset them
  const result: Vec2[][] = []
  for (const f of faces) {
    const poly = f.map((i) => nodes[i]!)
    const sa = signedArea(poly)
    if (sa >= 0) continue // outer boundary
    const thicknesses = f.map((n, i) => thick.get(`${n}-${f[(i + 1) % f.length]}`) ?? 0.1)
    const inset = insetPolygon(
      poly,
      thicknesses.map((t) => t / 2),
    )
    if (inset.length >= 3 && polygonArea(inset) >= minArea) result.push(inset)
  }
  return result
}

/** Offsets each edge i (p[i]→p[i+1]) inward by d[i]. Works for either orientation. */
export function insetPolygon(poly: Vec2[], d: number[]): Vec2[] {
  const n = poly.length
  const sign = signedArea(poly) > 0 ? 1 : -1
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]!
    const dir = norm(sub(q, p))
    const inward = sign > 0 ? v(-dir.y, dir.x) : v(dir.y, -dir.x)
    return { p: add(p, mul(inward, d[i]!)), dir, inward }
  })
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n]!
    const cur = lines[i]!
    const ix = lineIntersection(prev.p, prev.dir, cur.p, cur.dir)
    if (!ix || Math.abs(cross(prev.dir, cur.dir)) < 1e-6) {
      // Collinear edges (e.g. at a T-junction): step across
      out.push(add(poly[i]!, mul(prev.inward, d[(i - 1 + n) % n]!)))
      if (Math.abs(d[i]! - d[(i - 1 + n) % n]!) > 1e-6) out.push(add(poly[i]!, mul(cur.inward, d[i]!)))
    } else {
      out.push(add(prev.p, mul(prev.dir, ix.t)))
    }
  }
  return simplifyPolygon(out)
}

/** Removes duplicate and collinear vertices. */
export function simplifyPolygon(poly: Vec2[], eps = 1e-4): Vec2[] {
  let pts = poly.filter((p, i) => dist(p, poly[(i + 1) % poly.length]!) > eps)
  let changed = true
  while (changed && pts.length > 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]!
      const b = pts[i]!
      const c = pts[(i + 1) % pts.length]!
      if (Math.abs(cross(sub(b, a), sub(c, b))) < eps * Math.max(1, dist(a, c))) {
        pts = pts.filter((_, j) => j !== i)
        changed = true
        break
      }
    }
  }
  return pts
}

/** Percentage deviation between computed polygon area and stated area, or null. */
export function areaDeviation(room: Pick<Room, 'polygon' | 'statedArea'>): number | null {
  if (!room.statedArea || room.polygon.length < 3) return null
  return (polygonArea(room.polygon) - room.statedArea) / room.statedArea
}

/**
 * Tidies up roughly traced walls (e.g. from AI digitization): straightens
 * near-axis walls, merges nearby endpoints and closes T-junction gaps.
 */
export function cleanupWalls<T extends Pick<Wall, 'id' | 'a' | 'b'>>(input: T[], tol = 0.15, angleTolDeg = 4): T[] {
  const walls = input.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }))
  const angTol = (angleTolDeg * Math.PI) / 180
  const straighten = () => {
    for (const w of walls) {
      const ang = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x)
      const mod = ((ang % Math.PI) + Math.PI) % Math.PI // 0..π
      if (Math.min(mod, Math.PI - mod) < angTol) {
        const y = (w.a.y + w.b.y) / 2
        w.a.y = y
        w.b.y = y
      } else if (Math.abs(mod - Math.PI / 2) < angTol) {
        const x = (w.a.x + w.b.x) / 2
        w.a.x = x
        w.b.x = x
      }
    }
  }
  straighten()

  // Merge endpoint clusters
  const refs: Vec2[] = walls.flatMap((w) => [w.a, w.b])
  const done = new Set<Vec2>()
  for (const p of refs) {
    if (done.has(p)) continue
    const cluster = refs.filter((q) => !done.has(q) && dist(p, q) < tol)
    const cx = cluster.reduce((s, q) => s + q.x, 0) / cluster.length
    const cy = cluster.reduce((s, q) => s + q.y, 0) / cluster.length
    for (const q of cluster) {
      q.x = cx
      q.y = cy
      done.add(q)
    }
  }

  // Close T-junctions: free endpoints near another wall get projected onto it
  const shared = (p: Vec2) => refs.filter((q) => dist(p, q) < 1e-6).length > 1
  for (const w of walls) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end]
      if (shared(p)) continue
      let best: { point: Vec2; d: number } | null = null
      for (const o of walls) {
        if (o === w) continue
        const c = closestPointOnSegment(p, o.a, o.b)
        if (c.dist < tol && (!best || c.dist < best.d)) best = { point: c.point, d: c.dist }
      }
      if (best) {
        p.x = best.point.x
        p.y = best.point.y
      }
    }
  }
  return walls.filter((w) => dist(w.a, w.b) > tol / 2)
}

/** Position (point + along-wall offset) on a wall closest to p. */
export function projectOntoWall(p: Vec2, wall: Wall): { point: Vec2; offset: number; dist: number } {
  const c = closestPointOnSegment(p, wall.a, wall.b)
  return { point: c.point, offset: c.t * wallLength(wall), dist: c.dist }
}

export function nearestWall(
  p: Vec2,
  walls: Wall[],
  maxDist = Infinity,
): { wall: Wall; offset: number; dist: number } | null {
  let best: { wall: Wall; offset: number; dist: number } | null = null
  for (const w of walls) {
    const pr = projectOntoWall(p, w)
    if (pr.dist <= maxDist && (!best || pr.dist < best.dist)) best = { wall: w, offset: pr.offset, dist: pr.dist }
  }
  return best
}
