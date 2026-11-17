import type { Vec2 } from '@romslig/shared'

/**
 * The arithmetic of walking around in 3D, without three.js or the DOM so it can be tested: where a
 * stride goes, how the keys and the on-screen stick become a direction and a pace, and how a drag
 * turns the view. Positions are in plan coordinates: plan x is world x, plan y is world z.
 */

/** Eye height of the walker (m). */
export const EYE_HEIGHT = 1.6
/** Walking and running pace (m/s). */
export const WALK_SPEED = 1.4
export const RUN_SPEED = 3
/** A frame that took long (the tab was in the background) is not a long stride (s). */
const MAX_FRAME = 0.1

/**
 * Which way to go and how fast: `forward` along the view, `right` across it. Each is -1..1, and
 * the pair is scaled by `speed` (m/s), so a half-pushed stick walks at half pace.
 */
export interface WalkInput {
  forward: number
  right: number
  speed: number
}

export const STANDING: WalkInput = { forward: 0, right: 0, speed: 0 }

/**
 * Where one frame's stride would take the walker, before walls have their say (`walkStep`).
 * `facing` is where the camera looks, flattened onto the floor; its length does not matter. Looking
 * straight down or up there is no forward on the floor, and the walker stays put.
 */
export function strideTarget(from: Vec2, facing: Vec2, input: WalkInput, dt: number): Vec2 {
  const len = Math.hypot(facing.x, facing.y)
  if (len < 1e-9) return from
  const fx = facing.x / len
  const fy = facing.y / len
  // Right of the view, seen from above with world y up: (-fy, fx) in plan coordinates
  const step = input.speed * Math.min(dt, MAX_FRAME)
  return {
    x: from.x + (fx * input.forward - fy * input.right) * step,
    y: from.y + (fy * input.forward + fx * input.right) * step,
  }
}

/** The keyboard on a desktop: WASD or the arrows, Shift (left) to run. Keys are `KeyboardEvent.code`. */
export function keyInput(keys: Readonly<Record<string, boolean>>): WalkInput {
  const on = (...codes: string[]) => (codes.some((c) => keys[c]) ? 1 : 0)
  return {
    forward: on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown'),
    right: on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft'),
    speed: keys.ShiftLeft ? RUN_SPEED : WALK_SPEED,
  }
}

/** The middle of the stick where a resting thumb does not walk, as a share of its reach. */
const STICK_DEAD_ZONE = 0.15

/**
 * The on-screen stick. `dx`, `dy` is the finger's offset from the stick's middle in screen pixels
 * (y down) and `reach` how far the knob can go. Gives where to draw the knob (held inside the reach)
 * and the walk: up the screen is forward, and the pace grows from nothing at the edge of the dead
 * zone to a walking pace at full reach.
 */
export function stickInput(dx: number, dy: number, reach: number): { knob: Vec2; input: WalkInput } {
  const dist = Math.hypot(dx, dy)
  if (reach <= 0 || dist < 1e-9) return { knob: { x: 0, y: 0 }, input: STANDING }
  const held = Math.min(dist, reach) / dist
  const knob = { x: dx * held, y: dy * held }
  const push = Math.min(dist / reach, 1)
  if (push <= STICK_DEAD_ZONE) return { knob, input: STANDING }
  const pace = (push - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE)
  return { knob, input: { forward: (-dy / dist) * pace, right: (dx / dist) * pace, speed: WALK_SPEED } }
}

/** How far a dragging finger turns the view (radians per pixel): across a phone is about half a turn. */
export const LOOK_PER_PIXEL = Math.PI / 400
/** How far the view tilts up or down at most (radians), so a finger cannot flip it over. */
export const MAX_PITCH = 1.2

/**
 * A drag that turns the view, as the mouse does in pointer lock: right turns right, up looks up.
 * `yaw` and `pitch` are the camera's Euler angles in 'YXZ' order.
 */
export function turnView(view: { yaw: number; pitch: number }, dx: number, dy: number): { yaw: number; pitch: number } {
  const pitch = view.pitch - dy * LOOK_PER_PIXEL
  return { yaw: view.yaw - dx * LOOK_PER_PIXEL, pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)) }
}

/**
 * How far the pointer may move between press and release and still count as a click (px). A finger
 * wobbles more than a mouse, so after a small drag on a touch screen the release is not a tap that
 * selects whatever is under it.
 */
export function clickSlop(pointerType: string): number {
  return pointerType === 'touch' ? 10 : 4
}
