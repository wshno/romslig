import {
  closestPointOnSegment,
  cross,
  interiorPoint,
  pointInPolygon,
  polygonCentroid,
  sub,
  v,
  type Vec2,
} from '@romslig/shared'

/**
 * Decisions about which plan labels fit where. Everything here is pure and deterministic: text
 * width is estimated from a per-character factor instead of measured by Konva, erring on the wide
 * side so a label judged to fit really does. Sizes are in screen pixels unless named otherwise;
 * `scale` is screen pixels per meter.
 */

/** Average glyph width as a share of the font size (Konva's default sans-serif, rounded up). */
export const CHAR_WIDTH = 0.6
export const CHAR_WIDTH_BOLD = 0.66

/** Padding inside a label's background plate, in px. */
export const PLATE_PAD_X = 4
export const PLATE_PAD_Y = 2
export const LINE_HEIGHT = 1.2

/** Font size of edge dimensions, and the free space an edge needs beyond its label, in px. */
export const DIM_FONT_SIZE = 11
export const DIM_MARGIN = 8

/** Room name/area font size: the normal size, and the smallest it may shrink to, in px. */
export const ROOM_FONT_MAX = 13
export const ROOM_FONT_MIN = 9
/** Distance the room label plate keeps from the room's outline, in px. */
export const ROOM_LABEL_MARGIN = 2

/** Estimated width of the widest line of `text`, in px. */
export function textWidth(text: string, fontSize: number, bold = false): number {
  const longest = Math.max(0, ...text.split('\n').map((l) => [...l].length))
  return longest * fontSize * (bold ? CHAR_WIDTH_BOLD : CHAR_WIDTH)
}

/** Size of the background plate around `lines` of text, in px. */
export function plateSize(lines: string[], fontSize: number, bold = false): { width: number; height: number } {
  return {
    width: textWidth(lines.join('\n'), fontSize, bold) + 2 * PLATE_PAD_X,
    height: lines.length * fontSize * LINE_HEIGHT + 2 * PLATE_PAD_Y,
  }
}

/** Whether a dimension label fits along an edge of `edgePx` screen pixels (plate plus a margin). */
export function edgeLabelFits(edgePx: number, text: string, fontSize = DIM_FONT_SIZE): boolean {
  return edgePx >= plateSize([text], fontSize).width + DIM_MARGIN
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a))
  const d2 = cross(sub(b, a), sub(d, a))
  const d3 = cross(sub(d, c), sub(a, c))
  const d4 = cross(sub(d, c), sub(b, c))
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/**
 * Whether an axis-aligned rectangle (world units) centred on `at` lies inside the polygon: all its
 * corners are inside and no polygon edge cuts through it.
 */
export function rectInPolygon(at: Vec2, width: number, height: number, poly: Vec2[]): boolean {
  if (poly.length < 3) return false
  const hw = width / 2
  const hh = height / 2
  const corners = [v(at.x - hw, at.y - hh), v(at.x + hw, at.y - hh), v(at.x + hw, at.y + hh), v(at.x - hw, at.y + hh)]
  if (!corners.every((c) => pointInPolygon(c, poly))) return false
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    // A vertex inside the rectangle means the outline dents into it
    if (Math.abs(p.x - at.x) < hw && Math.abs(p.y - at.y) < hh) return false
    for (let k = 0; k < 4; k++) if (segmentsCross(p, q, corners[k]!, corners[(k + 1) % 4]!)) return false
  }
  return true
}

/** Distance from `p` to the nearest edge of the polygon (world units). */
export function edgeClearance(p: Vec2, poly: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, closestPointOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!).dist)
  }
  return best
}

/** Samples per side of the bounding-box grid that labelAnchors also tries. */
const ANCHOR_GRID = 8

/**
 * Where a room label may go, best first: the centroid when it is inside the room, then
 * `interiorPoint`, the centres of the room's corner triangles and a grid of sample points, those
 * inside the room only and roomiest (furthest from the outline) first. The centroid of an L- or
 * U-shaped room can lie outside it or squeezed against a wall.
 */
export function labelAnchors(poly: Vec2[]): Vec2[] {
  const c = polygonCentroid(poly)
  const rest: Vec2[] = [interiorPoint(poly)]
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    const r = poly[(i + 2) % poly.length]!
    rest.push(v((p.x + q.x + r.x) / 3, (p.y + q.y + r.y) / 3))
  }
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  for (let i = 0; i < ANCHOR_GRID; i++) {
    for (let j = 0; j < ANCHOR_GRID; j++) {
      rest.push(v(x0 + ((i + 0.5) / ANCHOR_GRID) * (x1 - x0), y0 + ((j + 0.5) / ANCHOR_GRID) * (y1 - y0)))
    }
  }
  const seen = new Set<string>()
  const inside = rest.filter((p) => {
    const key = `${p.x.toFixed(6)}:${p.y.toFixed(6)}`
    if (seen.has(key) || !pointInPolygon(p, poly)) return false
    seen.add(key)
    return true
  })
  inside.sort((a, b) => edgeClearance(b, poly) - edgeClearance(a, poly))
  return pointInPolygon(c, poly) ? [c, ...inside] : inside
}

export interface RoomLabelLayout {
  /** Centre of the label (world). */
  at: Vec2
  fontSize: number
  lines: string[]
  /** Plate size in px. */
  width: number
  height: number
}

/** Lines of a room label, optionally with a smallest font size of its own. */
export type LabelVariant = string[] | { lines: string[]; minFontSize: number }

/**
 * Picks the room label that fits inside the room on screen. Tries, in order, each variant of
 * `variants` (e.g. name+area, then name only, then area only) at font sizes from ROOM_FONT_MAX
 * down to ROOM_FONT_MIN (or the variant's own `minFontSize`), at each anchor of labelAnchors.
 * Returns null when nothing fits.
 */
export function roomLabelLayout(poly: Vec2[], variants: LabelVariant[], scale: number): RoomLabelLayout | null {
  if (poly.length < 3 || scale <= 0) return null
  const anchors = labelAnchors(poly)
  for (const variant of variants) {
    const { lines, minFontSize } = Array.isArray(variant) ? { lines: variant, minFontSize: ROOM_FONT_MIN } : variant
    if (lines.length === 0) continue
    for (let fontSize = ROOM_FONT_MAX; fontSize >= Math.max(minFontSize, ROOM_FONT_MIN); fontSize--) {
      const { width, height } = plateSize(lines, fontSize, true)
      const w = (width + 2 * ROOM_LABEL_MARGIN) / scale
      const h = (height + 2 * ROOM_LABEL_MARGIN) / scale
      const at = anchors.find((a) => rectInPolygon(a, w, h, poly))
      if (at) return { at, fontSize, lines, width, height }
    }
  }
  return null
}
