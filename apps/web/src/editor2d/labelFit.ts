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
 * Decisions about which plan labels fit where. Everything here is pure and deterministic: text is
 * measured by an injected `Measure` (the browser's canvas in the app, see measureText.ts; a fake in
 * tests), with a per-character estimate as the fallback. Sizes are in screen pixels unless named
 * otherwise; `scale` is screen pixels per meter.
 */

/** Width in px of one line of text at this font size and weight. */
export type Measure = (text: string, fontSize: number, bold: boolean) => number

/** Average glyph width as a share of the font size, used only when nothing can measure text. */
export const CHAR_WIDTH = 0.6
export const CHAR_WIDTH_BOLD = 0.66

/** Fallback measure: a generous per-character estimate. */
export const estimateWidth: Measure = (text, fontSize, bold) =>
  [...text].length * fontSize * (bold ? CHAR_WIDTH_BOLD : CHAR_WIDTH)

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

/**
 * One line of a label: plain text in the label's font, or text drawn `size` times the label's font
 * size, bold or not.
 */
export type LabelLine = string | { text: string; size: number; bold: boolean }

/** A line with its style resolved for a given label font size. */
export interface StyledLine {
  text: string
  fontSize: number
  bold: boolean
}

export function styleLine(line: LabelLine, fontSize: number, bold: boolean): StyledLine {
  return typeof line === 'string'
    ? { text: line, fontSize, bold }
    : { text: line.text, fontSize: fontSize * line.size, bold: line.bold }
}

/** Width of the widest of `lines`, in px. */
export function textWidth(lines: StyledLine[], measure: Measure = estimateWidth): number {
  return Math.max(0, ...lines.map((l) => measure(l.text, l.fontSize, l.bold)))
}

/** Size of the background plate around `lines`, in px; each line is LINE_HEIGHT of its label size. */
export function plateSize(
  lines: StyledLine[],
  lineFontSize: number,
  measure: Measure = estimateWidth,
): { width: number; height: number } {
  return {
    width: textWidth(lines, measure) + 2 * PLATE_PAD_X,
    height: lines.length * lineFontSize * LINE_HEIGHT + 2 * PLATE_PAD_Y,
  }
}

/** Whether a dimension label fits along an edge of `edgePx` screen pixels (plate plus a margin). */
export function edgeLabelFits(
  edgePx: number,
  text: string,
  fontSize = DIM_FONT_SIZE,
  measure: Measure = estimateWidth,
): boolean {
  return edgePx >= plateSize([{ text, fontSize, bold: false }], fontSize, measure).width + DIM_MARGIN
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a))
  const d2 = cross(sub(b, a), sub(d, a))
  const d3 = cross(sub(d, c), sub(a, c))
  const d4 = cross(sub(d, c), sub(b, c))
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function rectCorners(at: Vec2, width: number, height: number): Vec2[] {
  const hw = width / 2
  const hh = height / 2
  return [v(at.x - hw, at.y - hh), v(at.x + hw, at.y - hh), v(at.x + hw, at.y + hh), v(at.x - hw, at.y + hh)]
}

/**
 * Whether an axis-aligned rectangle (world units) centred on `at` lies inside the polygon: all its
 * corners are inside and no polygon edge cuts through it.
 */
export function rectInPolygon(at: Vec2, width: number, height: number, poly: Vec2[]): boolean {
  if (poly.length < 3) return false
  const hw = width / 2
  const hh = height / 2
  const corners = rectCorners(at, width, height)
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

/**
 * Whether an axis-aligned rectangle (world units) centred on `at` overlaps a convex polygon, such
 * as a furniture footprint (separating axis test; merely touching is no overlap).
 */
export function rectOverlapsConvex(at: Vec2, width: number, height: number, poly: Vec2[]): boolean {
  if (poly.length < 3) return false
  const corners = rectCorners(at, width, height)
  const axes: Vec2[] = [v(1, 0), v(0, 1)]
  for (let i = 0; i < poly.length; i++) {
    const e = sub(poly[(i + 1) % poly.length]!, poly[i]!)
    axes.push(v(-e.y, e.x))
  }
  const eps = 1e-9
  for (const ax of axes) {
    const proj = (ps: Vec2[]) => ps.map((p) => p.x * ax.x + p.y * ax.y)
    const a = proj(corners)
    const b = proj(poly)
    if (Math.max(...a) <= Math.min(...b) + eps || Math.max(...b) <= Math.min(...a) + eps) return false
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

function bounds(poly: Vec2[]): { x0: number; x1: number; y0: number; y1: number } {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/** Samples per side of the bounding-box grid that labelAnchors also tries. */
const ANCHOR_GRID = 10

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
  const { x0, x1, y0, y1 } = bounds(poly)
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
  /** The label's font size; a line may be drawn at a share of it (see LabelLine). */
  fontSize: number
  lines: StyledLine[]
  /** Plate size in px. */
  width: number
  height: number
  /** Whether the plate covers one of the obstacles (only when no free spot was found). */
  overlaps: boolean
}

/** Lines of a room label, optionally with a smallest font size of its own. */
export type LabelVariant = LabelLine[] | { lines: LabelLine[]; minFontSize: number }

export interface RoomLabelOptions {
  /** Measures text; the per-character estimate when left out. */
  measure?: Measure
  /** Convex shapes (world) the label should rather not cover, such as furniture footprints. */
  obstacles?: Vec2[][]
}

/**
 * Picks the room label that fits inside the room on screen. Tries, in order, each variant of
 * `variants` (e.g. name+area, then name only, then area only). Within a variant it first looks for
 * a spot that covers no obstacle at font sizes from ROOM_FONT_MAX down to ROOM_FONT_MIN (or the
 * variant's own `minFontSize`), and only then accepts one that covers an obstacle, again largest
 * font first; anchors are tried in labelAnchors order. Returns null when nothing fits.
 */
export function roomLabelLayout(
  poly: Vec2[],
  variants: LabelVariant[],
  scale: number,
  { measure = estimateWidth, obstacles = [] }: RoomLabelOptions = {},
): RoomLabelLayout | null {
  if (poly.length < 3 || scale <= 0) return null
  const anchors = labelAnchors(poly)
  const box = bounds(poly)
  // Only obstacles that reach into the room's bounding box can be in the way
  const near = obstacles.filter((o) => {
    const b = bounds(o)
    return b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0
  })
  for (const variant of variants) {
    const { lines, minFontSize } = Array.isArray(variant) ? { lines: variant, minFontSize: ROOM_FONT_MIN } : variant
    if (lines.length === 0) continue
    const sizes: { fontSize: number; styled: StyledLine[]; width: number; height: number; fitting: Vec2[] }[] = []
    for (let fontSize = ROOM_FONT_MAX; fontSize >= Math.max(minFontSize, ROOM_FONT_MIN); fontSize--) {
      const styled = lines.map((l) => styleLine(l, fontSize, true))
      const { width, height } = plateSize(styled, fontSize, measure)
      const w = (width + 2 * ROOM_LABEL_MARGIN) / scale
      const h = (height + 2 * ROOM_LABEL_MARGIN) / scale
      const fitting = anchors.filter((a) => rectInPolygon(a, w, h, poly))
      const free = fitting.find((a) => !near.some((o) => rectOverlapsConvex(a, w, h, o)))
      if (free) return { at: free, fontSize, lines: styled, width, height, overlaps: false }
      sizes.push({ fontSize, styled, width, height, fitting })
    }
    const fallback = sizes.find((s) => s.fitting.length > 0)
    if (fallback) {
      const { fontSize, styled, width, height, fitting } = fallback
      return { at: fitting[0]!, fontSize, lines: styled, width, height, overlaps: true }
    }
  }
  return null
}
