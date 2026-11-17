import { useCoarsePointer } from '../device.ts'

/**
 * Sizes in screen pixels for what is grabbed or snapped to in the 2D plan, for a fine pointer
 * (mouse, pen) and a coarse one (a finger). A fingertip covers some 40 px and hides what it
 * presses, so on a coarse pointer handles are drawn bigger, catch a press further out, and points
 * snap from further away. Desktop sizes are the ones the plan always had.
 */
export interface HitSizes {
  coarse: boolean
  /** Radius a drag handle (wall end, room corner, rotation) is drawn with. */
  handle: number
  /** Radius within which a press grabs a handle. */
  handleHit: number
  /** Radius the vertices of a run (pipe, duct, cable) are drawn with. */
  vertex: number
  /** Width of the band across a wall's outline that catches a press. */
  wall: number
  /** Width of the band along a thin line (a room edge, a run) that catches a press. */
  line: number
  /** How close a point must come to a wall, corner or end to snap to it. */
  snap: number
}

export const HIT: { fine: HitSizes; coarse: HitSizes } = {
  fine: { coarse: false, handle: 6, handleHit: 6, vertex: 5, wall: 8, line: 10, snap: 12 },
  coarse: { coarse: true, handle: 10, handleHit: 14, vertex: 10, wall: 24, line: 24, snap: 20 },
}

export const hitSizes = (coarse: boolean): HitSizes => (coarse ? HIT.coarse : HIT.fine)

/**
 * The hitStrokeWidth that makes a handle drawn with `radius` (and a 2 px stroke) catch presses out
 * to `hit`. Never below the stroke itself, so a fine pointer keeps Konva's default hit area.
 */
export const handleHitStroke = (radius: number, hit: number): number => Math.max(2, 2 * (hit - radius))

/**
 * The hit sizes for the current pointer. Follows changes, such as a tablet docked to a keyboard
 * with a touchpad, or the device toolbar in the browser's developer tools.
 */
export function useHitSizes(): HitSizes {
  return hitSizes(useCoarsePointer())
}
