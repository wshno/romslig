import { clampOpening, lerp, wallLength } from './geometry.ts'
import type { Scenario, Vec2, Wall } from './model.ts'
import { ROOM_COLORS } from './roomColors.ts'

const WALL_COLOR = '#334155'
const WINDOW_COLOR = '#bfdbfe'
const UNKNOWN_ROOM_COLOR = '#e2e8f0'

/**
 * Every coordinate goes through here on its way into the SVG (centimetre precision). Together with
 * colours taken from our own table, that means nothing a user typed can end up in the markup.
 */
const n = (x: number) => (Number.isFinite(x) ? String(Math.round(x * 100) / 100) : '0')
const pt = (p: Vec2) => `${n(p.x)},${n(p.y)}`
const along = (w: Wall, s: number) => lerp(w.a, w.b, s / wallLength(w))

/**
 * A small plan drawing of a variant as SVG: room floors in their type colour, walls with gaps
 * where there is a door or a doorway, and windows as a light line in the wall. A variant with
 * nothing drawn yet gives an empty dashed frame.
 */
export function planThumbnailSvg(scenario: Pick<Scenario, 'walls' | 'openings' | 'rooms'>): string {
  const walls = scenario.walls.filter((w) => wallLength(w) > 1e-6 && Number.isFinite(wallLength(w)))
  const rooms = scenario.rooms.filter((r) => r.polygon.length >= 3)
  const points = [...walls.flatMap((w) => [w.a, w.b]), ...rooms.flatMap((r) => r.polygon)].filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  )
  const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox='
  if (points.length === 0)
    return (
      `${open}"0 0 4 3">` +
      '<rect x="0.3" y="0.3" width="3.4" height="2.4" rx="0.1" fill="none" stroke="#cbd5e1" stroke-width="0.06" stroke-dasharray="0.2 0.14"/>' +
      '</svg>'
    )

  const minX = Math.min(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const width = Math.max(...points.map((p) => p.x)) - minX
  const height = Math.max(...points.map((p) => p.y)) - minY
  const size = Math.max(width, height, 1)
  // A 10 cm wall in a 15 m plan would be thinner than a pixel in the list
  const minStroke = size / 60
  const pad = size * 0.04 + Math.max(minStroke, ...walls.map((w) => w.thickness)) / 2

  const out = [`${open}"${n(minX - pad)} ${n(minY - pad)} ${n(width + 2 * pad)} ${n(height + 2 * pad)}">`]
  for (const r of rooms) {
    const fill = Object.hasOwn(ROOM_COLORS, r.type) ? ROOM_COLORS[r.type] : UNKNOWN_ROOM_COLOR
    out.push(`<polygon points="${r.polygon.map(pt).join(' ')}" fill="${fill}"/>`)
  }

  const windows: string[] = []
  for (const w of walls) {
    const stroke = Math.max(w.thickness, minStroke)
    const L = wallLength(w)
    const onWall = scenario.openings.filter((o) => o.wallId === w.id).map((o) => ({ o, ...clampOpening(o, w) }))
    // The wall runs half its thickness past both ends, which closes the corners
    let cursor = -stroke / 2
    const solid: string[] = []
    for (const { start, end } of onWall.filter((x) => x.o.kind !== 'window').sort((a, b) => a.start - b.start)) {
      if (start > cursor + 1e-6) solid.push(`M${pt(along(w, cursor))}L${pt(along(w, start))}`)
      cursor = Math.max(cursor, end)
    }
    if (cursor < L + stroke / 2) solid.push(`M${pt(along(w, cursor))}L${pt(along(w, L + stroke / 2))}`)
    if (solid.length)
      out.push(`<path d="${solid.join('')}" fill="none" stroke="${WALL_COLOR}" stroke-width="${n(stroke)}"/>`)
    for (const { o, start, end } of onWall)
      if (o.kind === 'window')
        windows.push(
          `<path d="M${pt(along(w, start))}L${pt(along(w, end))}" fill="none" stroke="${WINDOW_COLOR}" stroke-width="${n(stroke * 0.5)}"/>`,
        )
  }
  return out.join('') + windows.join('') + '</svg>'
}
