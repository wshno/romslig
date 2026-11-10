import { getCatalogItem, type CatalogItem } from './catalog.ts'
import { doorSwingNormal, footprint, itemSize, roomAt, roomEdges, toWorld, wallPolygon } from './furniture.ts'
import {
  add,
  clampOpening,
  closestPointOnSegment,
  cross,
  dist,
  lerp,
  mul,
  norm,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  sub,
  wallDir,
  wallLength,
} from './geometry.ts'
import type { FurnitureItem, Scenario, Vec2, Wall } from './model.ts'
import { ROOM_COLORS } from './roomColors.ts'

/** One line of the furniture list: the items in one room that have the same name and size. */
export interface FurnitureRow {
  /** The number these items carry in the plan drawing. */
  no: number
  name: string
  count: number
  /** Width, depth and height (m). */
  w: number
  d: number
  h: number
  /** Null for items that stand outside every room. */
  roomId: string | null
  room: string | null
  itemIds: string[]
}

const cm = (m: number) => Math.round(m * 100)

/**
 * The furniture of a variant as a list: one row per name and size in each room, with how many
 * there are. Rooms come in the order of the variant, items outside every room last, and the
 * rows are numbered from 1 in that order.
 */
export function furnitureList(scenario: Pick<Scenario, 'furniture' | 'rooms'>): FurnitureRow[] {
  const rooms = scenario.rooms.filter((r) => r.polygon.length >= 3)
  const place = new Map<string | null, number>(rooms.map((r, i) => [r.id, i]))
  place.set(null, rooms.length)
  const rows = new Map<string, FurnitureRow>()
  for (const f of scenario.furniture) {
    const cat = getCatalogItem(f.catalogId)
    const { w, d, h } = itemSize(f, cat)
    const room = roomAt({ x: f.x, y: f.y }, rooms)
    const name = f.label?.trim() || cat.name
    const key = JSON.stringify([room?.id ?? null, name, cm(w), cm(d), cm(h)])
    const row = rows.get(key)
    if (row) {
      row.count++
      row.itemIds.push(f.id)
    } else
      rows.set(key, {
        no: 0,
        name,
        count: 1,
        w,
        d,
        h,
        roomId: room?.id ?? null,
        room: room?.name ?? null,
        itemIds: [f.id],
      })
  }
  // The sort is stable: within a room the rows keep the order their first item was placed in
  return [...rows.values()]
    .sort((a, b) => place.get(a.roomId)! - place.get(b.roomId)!)
    .map((r, i) => ({ ...r, no: i + 1 }))
}

/**
 * Where to write a room's name: the middle of the room when that is a good spot, otherwise the
 * point inside the room that is farthest from its walls (an L-shaped room has its middle in the
 * corner, or outside the room altogether).
 */
export function labelPoint(poly: Vec2[]): Vec2 {
  const centre = polygonCentroid(poly)
  if (poly.length < 3) return centre
  const room = (p: Vec2) =>
    Math.min(...poly.map((a, i) => closestPointOnSegment(p, a, poly[(i + 1) % poly.length]!).dist))
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const STEPS = 24
  const dx = (Math.max(...xs) - x0) / STEPS
  const dy = (Math.max(...ys) - y0) / STEPS
  let best: { p: Vec2; room: number } | null = null
  for (let i = 0; i < STEPS; i++)
    for (let j = 0; j < STEPS; j++) {
      const p = { x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy }
      if (!pointInPolygon(p, poly)) continue
      const r = room(p)
      if (!best || r > best.room) best = { p, room: r }
    }
  if (!best) return centre
  return pointInPolygon(centre, poly) && room(centre) >= best.room * 0.7 ? centre : best.p
}

export interface PlanDrawingOptions {
  /** The inside length of every room edge, and the outer size of the plan. Default true. */
  dimensions?: boolean
  /** The furniture, each item with its number from furnitureList. Default true. */
  furniture?: boolean
}

export interface PlanDrawing {
  svg: string
  /** Size of the drawing with its margins (m). The SVG itself counts in centimetres. */
  width: number
  height: number
}

const WALL = '#1f2937'
const INK = '#0f172a'
const INSIDE_DIMENSION = '#1e40af'
const OUTSIDE_DIMENSION = '#475569'
const FURNITURE_EDGE = '#334155'
const UNKNOWN_ROOM = '#e2e8f0'
const UNKNOWN_FILL = '#8a8f96'
/** Wall ends this close to each other (m) are one corner. */
const CORNER = 0.02

const metres = (m: number) => `${m.toFixed(2).replace('.', ',')} m`
const squareMetres = (m2: number) => `${m2.toFixed(1).replace('.', ',')} m²`

/** Metres in, centimetres with one decimal out: every number in the markup goes through here. */
const n = (m: number) => (Number.isFinite(m) ? String(Math.round(m * 1000) / 10) : '0')
const pt = (p: Vec2) => `${n(p.x)},${n(p.y)}`
const degrees = (a: number) => (Number.isFinite(a) ? String(Math.round(a * 10) / 10) : '0')

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

/**
 * Something a user typed (a room name, a furniture label), as text in the SVG. Markup characters
 * are escaped, and what XML does not allow at all (control characters, halves of a surrogate
 * pair) is dropped, so a name can neither add markup nor make the file unreadable.
 */
function esc(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c === 9 || c === 10 || c === 13) out += ' '
    else if (c >= 0x20 && !(c >= 0xd800 && c <= 0xdfff) && c !== 0xfffe && c !== 0xffff) out += ENTITIES[ch] ?? ch
  }
  return out
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim())
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

/** A furniture colour comes from the project for the user's own types: only plain colours pass. */
const colour = (c: string) => (/^(#[0-9a-f]{3,8}|[a-z]{3,30})$/i.test(c) ? c : UNKNOWN_FILL)

/** Roughly how wide a text is drawn. The font is the reader's, so this is an estimate. */
const textWidth = (text: string, size: number, bold = false) => Array.from(text).length * size * (bold ? 0.6 : 0.55)

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
function bounds(points: Vec2[]): Box {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}
const inBox = (p: Vec2, b: Box, margin = 0) =>
  p.x > b.minX - margin && p.x < b.maxX + margin && p.y > b.minY - margin && p.y < b.maxY + margin

/** How far it is from wall to wall through `p`, measured across the page. */
function widthAt(p: Vec2, poly: Vec2[]): number {
  let left = -Infinity
  let right = Infinity
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    if (a.y > p.y === b.y > p.y) return
    const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)
    if (x < p.x) left = Math.max(left, x)
    else right = Math.min(right, x)
  })
  return right - left
}

/**
 * How far past its end point a wall is drawn, so that it reaches the outer face of the walls it
 * meets there and the corner closes. Nothing for a free end or a wall that only continues.
 */
function cornerReach(w: Wall, end: Vec2, walls: Wall[]): number {
  const d = wallDir(w)
  let reach = 0
  for (const o of walls) {
    if (o === w || (dist(o.a, end) > CORNER && dist(o.b, end) > CORNER)) continue
    reach = Math.max(reach, (o.thickness / 2) * Math.abs(cross(d, wallDir(o))))
  }
  return reach
}

interface Piece {
  item: FurnitureItem
  cat: CatalogItem
  outline: Vec2[]
  /** 0 = rug, 1 = stands on the floor, 2 = hangs on the wall: drawn in that order. */
  layer: number
}

function layerOf(cat: CatalogItem): number {
  if (cat.shape === 'rug') return 0
  return (cat.elevation ?? 0) > 0 ? 2 : 1
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" font-family="\'Segoe UI\', system-ui, sans-serif"'

function emptyDrawing(): PlanDrawing {
  const svg =
    `${SVG} viewBox="0 0 400 300" width="400" height="300">` +
    '<rect width="400" height="300" fill="#fff"/>' +
    '<rect x="20" y="20" width="360" height="260" rx="8" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="10 7"/>' +
    '<text x="200" y="150" dy="0.35em" font-size="14" text-anchor="middle" fill="#64748b">Ingenting er tegnet i denne varianten ennå</text>' +
    '</svg>'
  return { svg, width: 4, height: 3 }
}

/**
 * A variant as a plan drawing to print or save: room floors with name and area, walls with
 * closed corners, doors with their swing, windows and doorways, furniture numbered like
 * furnitureList, the inside length of every room edge, the outer size of the plan and a scale
 * bar. Sizes of text and lines follow the size of the plan, so a studio and a house are equally
 * readable on a sheet of paper.
 */
export function planDrawingSvg(
  scenario: Pick<Scenario, 'walls' | 'openings' | 'rooms' | 'furniture'>,
  options: PlanDrawingOptions = {},
): PlanDrawing {
  const withDimensions = options.dimensions ?? true
  const finite = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y)
  const walls = scenario.walls.filter((w) => finite(w.a) && finite(w.b) && wallLength(w) > 1e-6)
  const rooms = scenario.rooms.filter((r) => r.polygon.length >= 3 && r.polygon.every(finite))
  const pieces: Piece[] =
    (options.furniture ?? true)
      ? scenario.furniture
          .filter((f) => finite(f) && Number.isFinite(f.rotation))
          .map((item) => {
            const cat = getCatalogItem(item.catalogId)
            return { item, cat, outline: footprint(item, itemSize(item, cat)), layer: layerOf(cat) }
          })
          .sort((a, b) => a.layer - b.layer)
      : []
  const openings = scenario.openings.flatMap((o) => {
    const wall = walls.find((w) => w.id === o.wallId)
    if (!wall) return []
    const { start, end } = clampOpening(o, wall)
    return end - start > 0.005 ? [{ o, wall, start, end }] : []
  })

  const built = [...walls.flatMap(wallPolygon), ...rooms.flatMap((r) => r.polygon)]
  const doorTips = openings.flatMap(({ o, wall, start, end }) => {
    if (o.kind !== 'door') return []
    const hinge = add(wall.a, mul(wallDir(wall), start))
    return [add(hinge, mul(doorSwingNormal(o, wall), wall.thickness / 2 + end - start))]
  })
  const everything = [...built, ...doorTips, ...pieces.flatMap((p) => p.outline)]
  if (everything.length === 0) return emptyDrawing()

  const box = bounds(everything)
  /** One hundredth of the plan's longest side: what text and line sizes are counted in. */
  const u = Math.max(box.maxX - box.minX, box.maxY - box.minY, 3) / 100
  const outer = withDimensions && built.length > 0 ? bounds(built) : null
  const pad = 2.5 * u
  const left = box.minX - pad - (outer ? 5 * u : 0)
  const top = box.minY - pad - (outer ? 5 * u : 0)
  const width = box.maxX + pad - left
  const height = box.maxY + pad + 4.5 * u - top

  const label = (
    at: Vec2,
    text: string,
    style: { size: number; fill?: string; bold?: boolean; rotate?: number; start?: boolean },
  ) =>
    `<text x="${n(at.x)}" y="${n(at.y)}" dy="0.35em" font-size="${n(style.size)}" stroke-width="${n(style.size * 0.28)}"` +
    (style.fill ? ` fill="${style.fill}"` : '') +
    (style.bold ? ' font-weight="bold"' : '') +
    (style.start ? ' text-anchor="start"' : '') +
    (style.rotate ? ` transform="rotate(${degrees(style.rotate)} ${pt(at)})"` : '') +
    `>${esc(text)}</text>`

  const out = [
    `${SVG} viewBox="${n(left)} ${n(top)} ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}">`,
    `<rect x="${n(left)}" y="${n(top)}" width="${n(width)}" height="${n(height)}" fill="#fff"/>`,
  ]

  // Floors
  for (const r of rooms) {
    const fill = Object.hasOwn(ROOM_COLORS, r.type) ? ROOM_COLORS[r.type] : UNKNOWN_ROOM
    out.push(`<polygon points="${r.polygon.map(pt).join(' ')}" fill="${fill}" fill-opacity="0.5"/>`)
  }

  // Room names. Placed before anything else that carries text, which then keeps clear of them.
  const nameBoxes: Box[] = []
  const roomTexts: string[] = []
  for (const r of rooms) {
    const at = labelPoint(r.polygon)
    const name = clip(r.name, 28)
    const area = squareMetres(polygonArea(r.polygon))
    const letters = Math.max(Array.from(name).length, Array.from(area).length)
    const size = Math.min(2 * u, Math.max(1.2 * u, (widthAt(at, r.polygon) * 0.9) / (letters * 0.6)))
    const half = Math.max(textWidth(name, size, true), textWidth(area, size * 0.85)) / 2
    nameBoxes.push({ minX: at.x - half, maxX: at.x + half, minY: at.y - 1.3 * size, maxY: at.y + 1.3 * size })
    if (name) roomTexts.push(label({ x: at.x, y: at.y - 0.6 * size }, name, { size, bold: true }))
    roomTexts.push(label({ x: at.x, y: at.y + (name ? 0.6 * size : 0) }, area, { size: size * 0.85 }))
  }

  // Furniture: rugs first, then what stands on the floor, then what hangs on the wall
  if (pieces.length) {
    out.push(`<g stroke="${FURNITURE_EDGE}" stroke-width="${n(0.15 * u)}" stroke-linejoin="round">`)
    const dashes = ` stroke-dasharray="${n(0.9 * u)} ${n(0.6 * u)}"`
    for (const { cat, outline, layer } of pieces) {
      const look = [` fill-opacity="0.45"${dashes}`, ' fill-opacity="0.9"', ` fill-opacity="0.25"${dashes}`][layer]!
      out.push(`<polygon points="${outline.map(pt).join(' ')}" fill="${colour(cat.color)}"${look}/>`)
      // The front edge, so it shows which way a sofa or a wardrobe faces
      if (layer === 1) out.push(`<path d="M${pt(outline[3]!)}L${pt(outline[2]!)}" stroke-width="${n(0.4 * u)}"/>`)
    }
    out.push('</g>')
  }

  // Walls, with a gap for every door, window and doorway
  out.push(`<g fill="none" stroke="${WALL}">`)
  for (const w of walls) {
    const d = wallDir(w)
    const at = (s: number) => add(w.a, mul(d, s))
    const gaps = openings.filter((x) => x.wall === w).sort((a, b) => a.start - b.start)
    let from = -cornerReach(w, w.a, walls)
    const to = wallLength(w) + cornerReach(w, w.b, walls)
    let path = ''
    for (const g of gaps) {
      if (g.start > from + 1e-6) path += `M${pt(at(from))}L${pt(at(g.start))}`
      from = Math.max(from, g.end)
    }
    if (to > from + 1e-6) path += `M${pt(at(from))}L${pt(at(to))}`
    if (path) out.push(`<path d="${path}" stroke-width="${n(w.thickness)}"/>`)
  }
  out.push('</g>')

  // What is in the gaps
  if (openings.length) {
    const thin = n(0.14 * u)
    const dashed = ` stroke-dasharray="${n(0.6 * u)} ${n(0.45 * u)}"`
    out.push(`<g fill="none" stroke="${WALL}" stroke-width="${n(0.22 * u)}">`)
    for (const { o, wall, start, end } of openings) {
      const d = wallDir(wall)
      const p0 = add(wall.a, mul(d, start))
      const p1 = add(wall.a, mul(d, end))
      const face = mul({ x: -d.y, y: d.x }, wall.thickness / 2)
      if (o.kind === 'window') {
        const frame = [add(p0, face), add(p1, face), sub(p1, face), sub(p0, face)]
        out.push(
          `<polygon points="${frame.map(pt).join(' ')}" fill="#fff"/>`,
          `<path d="M${pt(p0)}L${pt(p1)}" stroke-width="${thin}"/>`,
        )
      } else if (o.kind === 'door') {
        // Hinged at the start of the gap, the leaf drawn open at a right angle to the wall
        const swing = doorSwingNormal(o, wall)
        const leaf = end - start
        const hinge = add(p0, mul(swing, wall.thickness / 2))
        const tip = add(hinge, mul(swing, leaf))
        const closed = add(p1, mul(swing, wall.thickness / 2))
        const sweep = cross(swing, d) > 0 ? 1 : 0
        out.push(
          `<path d="M${pt(hinge)}L${pt(tip)}"/>`,
          `<path d="M${pt(tip)}A${n(leaf)} ${n(leaf)} 0 0 ${sweep} ${pt(closed)}" stroke-width="${thin}"${dashed}/>`,
        )
      } else {
        out.push(
          `<path d="M${pt(add(p0, face))}L${pt(add(p1, face))}M${pt(sub(p0, face))}L${pt(sub(p1, face))}" stroke-width="${thin}"${dashed}/>`,
        )
      }
    }
    out.push('</g>')
  }

  const texts: string[] = []
  const small = 1.5 * u
  /** Where the dimensions inside the rooms are written, each as the line its text runs along. */
  const dimensionLines: [Vec2, Vec2][] = []

  if (withDimensions) {
    // Inside every room: the length of each edge, written along it. Left out where it does not
    // fit on the edge, or would land on the room's name.
    for (const r of rooms) {
      const sides = roomEdges(r.polygon).map(({ a, b, length, inward }) => {
        const text = metres(length)
        const half = textWidth(text, small) / 2
        const at = add(lerp(a, b, 0.5), mul(inward, 1.3 * u))
        return {
          text,
          half,
          at,
          length,
          d: norm(sub(b, a)),
          fits: length >= 0.3 && length >= 2 * half + u && !nameBoxes.some((box) => inBox(at, box, 0.8 * u)),
          covered: pieces.some((piece) => pointInPolygon(at, piece.outline)),
        }
      })
      sides.forEach((side, i) => {
        if (!side.fits) return
        // A room with four sides has each length once when the side across from it is as long: on
        // the first of the two, or on the second when only the first is under a piece of furniture
        const across = sides.length === 4 ? sides[(i + 2) % 4]! : undefined
        if (across?.fits && Math.abs(across.length - side.length) < 0.005) {
          const onSecond = i < 2 ? side.covered && !across.covered : across.covered && !side.covered
          if (onSecond === i < 2) return
        }
        // Kept upright: an edge that runs leftwards is written the other way
        const { at, d, half } = side
        let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI
        if (angle > 90) angle -= 180
        if (angle <= -90) angle += 180
        texts.push(label(at, side.text, { size: small, fill: INSIDE_DIMENSION, rotate: angle }))
        dimensionLines.push([sub(at, mul(d, half)), add(at, mul(d, half))])
      })
    }
  }
  if (outer) {
    // Outside the plan: its full width above and its full depth to the left, wall face to wall face
    const tick = 0.7 * u
    const y = box.minY - 2.6 * u
    const x = box.minX - 2.6 * u
    out.push(
      `<path d="M${pt({ x: outer.minX, y })}L${pt({ x: outer.maxX, y })}` +
        `M${pt({ x: outer.minX, y: y - tick })}L${pt({ x: outer.minX, y: y + tick })}` +
        `M${pt({ x: outer.maxX, y: y - tick })}L${pt({ x: outer.maxX, y: y + tick })}` +
        `M${pt({ x, y: outer.minY })}L${pt({ x, y: outer.maxY })}` +
        `M${pt({ x: x - tick, y: outer.minY })}L${pt({ x: x + tick, y: outer.minY })}` +
        `M${pt({ x: x - tick, y: outer.maxY })}L${pt({ x: x + tick, y: outer.maxY })}"` +
        ` fill="none" stroke="${OUTSIDE_DIMENSION}" stroke-width="${n(0.14 * u)}"/>`,
    )
    texts.push(
      label({ x: (outer.minX + outer.maxX) / 2, y: y - 1.4 * u }, metres(outer.maxX - outer.minX), {
        size: small,
        fill: OUTSIDE_DIMENSION,
      }),
      label({ x: x - 1.4 * u, y: (outer.minY + outer.maxY) / 2 }, metres(outer.maxY - outer.minY), {
        size: small,
        fill: OUTSIDE_DIMENSION,
        rotate: -90,
      }),
    )
  }

  texts.push(...roomTexts)

  // Furniture numbers: in the middle of the item, or in a corner of it when the middle is under
  // another item (a rug under a table), under a room's name or under a dimension
  if (pieces.length) {
    const numberOf = new Map(furnitureList(scenario).flatMap((row) => row.itemIds.map((id) => [id, row.no] as const)))
    pieces.forEach(({ item, cat }, i) => {
      const no = numberOf.get(item.id)
      if (no === undefined) return
      const { w, d } = itemSize(item, cat)
      const spots = [
        [0, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sy]) => toWorld(item, { x: sx! * w * 0.3, y: sy! * d * 0.3 }))
      const taken = (p: Vec2) =>
        pieces.slice(i + 1).some((above) => pointInPolygon(p, above.outline)) ||
        nameBoxes.some((box) => inBox(p, box, 0.7 * u)) ||
        dimensionLines.some(([a, b]) => closestPointOnSegment(p, a, b).dist < 1.6 * u)
      texts.push(label(spots.find((p) => !taken(p)) ?? spots[0]!, String(no), { size: 1.4 * u, bold: true }))
    })
  }

  // Scale bar under the plan
  const bar = [20, 10, 5, 2, 1].find((m) => m <= (box.maxX - box.minX) * 0.3) ?? 0.5
  const barY = box.maxY + 3.2 * u
  out.push(
    `<path d="M${pt({ x: box.minX, y: barY - 0.6 * u })}L${pt({ x: box.minX, y: barY + 0.6 * u })}` +
      `M${pt({ x: box.minX, y: barY })}L${pt({ x: box.minX + bar, y: barY })}` +
      `M${pt({ x: box.minX + bar, y: barY - 0.6 * u })}L${pt({ x: box.minX + bar, y: barY + 0.6 * u })}"` +
      ` fill="none" stroke="${INK}" stroke-width="${n(0.22 * u)}"/>`,
  )
  texts.push(
    label({ x: box.minX + bar + u, y: barY }, `${String(bar).replace('.', ',')} m`, { size: small, start: true }),
  )

  // All text last and on top, with a white edge that keeps it readable over walls and furniture
  out.push(
    `<g text-anchor="middle" fill="${INK}" stroke="#fff" stroke-linejoin="round" paint-order="stroke">`,
    ...texts,
    '</g></svg>',
  )
  return { svg: out.join(''), width, height }
}
