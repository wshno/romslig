import { dist, type Vec2 } from '@romslig/shared'
import { fmtM } from '../theme.ts'

/** A measurement with the measuring tool: `b` is null while the second point is still to be clicked. */
export interface Measurement {
  a: Vec2
  b: Vec2 | null
}

/** The angle of the line a→b against the horizontal, 0–90°, whichever way it points. */
export function measureAngle(a: Vec2, b: Vec2): number {
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  if (dx < 1e-9 && dy < 1e-9) return 0
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

/** The distance a→b as the readout shows it, e.g. "Avstand: 3,50 m". */
export function distanceText(a: Vec2, b: Vec2): string {
  return `Avstand: ${fmtM(dist(a, b))}`
}

/**
 * The horizontal and vertical parts of a→b and its angle, e.g. "Δx 3,00 m · Δy 1,20 m · 22°".
 * Empty for a line that is straight across or up and down, where they add nothing.
 */
export function measureDetails(a: Vec2, b: Vec2): string {
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  if (dx < 0.005 || dy < 0.005) return ''
  return `Δx ${fmtM(dx)} · Δy ${fmtM(dy)} · ${Math.round(measureAngle(a, b))}°`
}
