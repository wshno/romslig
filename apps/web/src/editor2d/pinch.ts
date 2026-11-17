import type { Vec2 } from '@romslig/shared'
import type { PlanView } from './Plan2D.tsx'

/** Zoom limits of the plan, in screen pixels per metre: the same for the wheel and a pinch. */
export const MIN_SCALE = 5
export const MAX_SCALE = 800

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * The view after a scale change around a fixed screen point: the plan point under `at` stays
 * under it. The scale is held within the zoom limits.
 */
export function zoomAt(view: PlanView, at: Vec2, scale: number): PlanView {
  const world = { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale }
  const ns = clampScale(scale)
  return { scale: ns, x: at.x - world.x * ns, y: at.y - world.y * ns }
}

const mid = ([a, b]: [Vec2, Vec2]): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const span = ([a, b]: [Vec2, Vec2]): number => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * The view after two fingers moved from `from` to `to` (screen pixels in the plan's container),
 * starting from `view`: the scale follows the distance between the fingers, and the plan point
 * that lay midway between them follows that midpoint, so pinching zooms and moving both fingers
 * pans, in one gesture. Always worked out from where the gesture started, so it does not drift.
 */
export function pinchView(view: PlanView, from: [Vec2, Vec2], to: [Vec2, Vec2]): PlanView {
  const d0 = span(from)
  // Two fingers on (almost) the same spot give no distance to scale by: only pan
  const factor = d0 < 1 ? 1 : span(to) / d0
  const a = mid(from)
  const b = mid(to)
  const world = { x: (a.x - view.x) / view.scale, y: (a.y - view.y) / view.scale }
  const ns = clampScale(view.scale * factor)
  return { scale: ns, x: b.x - world.x * ns, y: b.y - world.y * ns }
}
