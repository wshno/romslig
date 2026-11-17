import { describe, expect, it } from 'vitest'
import {
  MAX_PITCH,
  RUN_SPEED,
  STANDING,
  WALK_SPEED,
  clickSlop,
  keyInput,
  stickInput,
  strideTarget,
  turnView,
} from './walkMotion.ts'

const at = { x: 2, y: 3 }
const near = (want: { x: number; y: number }) => ({ x: expect.closeTo(want.x, 9), y: expect.closeTo(want.y, 9) })

describe('strideTarget', () => {
  it('goes along the view for forward and across it for right', () => {
    // Looking down -z (plan -y), the way an untouched camera looks: right is +x
    const facing = { x: 0, y: -1 }
    expect(strideTarget(at, facing, { forward: 1, right: 0, speed: 1 }, 0.05)).toEqual(near({ x: 2, y: 2.95 }))
    expect(strideTarget(at, facing, { forward: 0, right: 1, speed: 1 }, 0.05)).toEqual(near({ x: 2.05, y: 3 }))
    expect(strideTarget(at, facing, { forward: -1, right: -1, speed: 2 }, 0.05)).toEqual(near({ x: 1.9, y: 3.1 }))
  })

  it('ignores how long the facing vector is', () => {
    const input = { forward: 1, right: 0, speed: 1 }
    expect(strideTarget(at, { x: 3, y: 0 }, input, 0.1)).toEqual(near(strideTarget(at, { x: 0.2, y: 0 }, input, 0.1)))
  })

  it('does not take a long stride after a long frame', () => {
    const input = { forward: 1, right: 0, speed: 1 }
    expect(strideTarget(at, { x: 1, y: 0 }, input, 2)).toEqual(near({ x: 2.1, y: 3 }))
  })

  it('stays put with no input, or with no forward on the floor (looking straight down)', () => {
    expect(strideTarget(at, { x: 1, y: 0 }, STANDING, 0.05)).toEqual(near(at))
    expect(strideTarget(at, { x: 0, y: 0 }, { forward: 1, right: 0, speed: 1 }, 0.05)).toEqual(near(at))
  })
})

describe('keyInput', () => {
  it('reads WASD and the arrows, one step per direction even with both held', () => {
    expect(keyInput({ KeyW: true })).toEqual({ forward: 1, right: 0, speed: WALK_SPEED })
    expect(keyInput({ KeyW: true, ArrowUp: true, KeyA: true })).toEqual({ forward: 1, right: -1, speed: WALK_SPEED })
    expect(keyInput({ ArrowDown: true, ArrowRight: true })).toEqual({ forward: -1, right: 1, speed: WALK_SPEED })
    // Opposite keys cancel out
    expect(keyInput({ KeyW: true, KeyS: true })).toMatchObject({ forward: 0, right: 0 })
  })

  it('runs with the left Shift', () => {
    expect(keyInput({ KeyW: true, ShiftLeft: true }).speed).toBe(RUN_SPEED)
    expect(keyInput({ KeyW: true, ShiftRight: true }).speed).toBe(WALK_SPEED)
  })
})

describe('stickInput', () => {
  it('walks forward when pushed up the screen and right when pushed right, at full pace at full reach', () => {
    const up = stickInput(0, -50, 50).input
    expect(up.forward).toBeCloseTo(1)
    expect(up.right).toBeCloseTo(0)
    expect(up.speed).toBe(WALK_SPEED)
    const right = stickInput(50, 0, 50).input
    expect(right.forward).toBeCloseTo(0)
    expect(right.right).toBeCloseTo(1)
  })

  it('keeps the knob inside its reach and does not go faster beyond it', () => {
    const { knob, input } = stickInput(0, 200, 50)
    expect(knob).toEqual(near({ x: 0, y: 50 }))
    expect(input.forward).toBeCloseTo(-1)
  })

  it('walks slower when pushed part of the way', () => {
    const half = stickInput(30, 40, 100).input
    expect(Math.hypot(half.forward, half.right)).toBeGreaterThan(0)
    expect(Math.hypot(half.forward, half.right)).toBeLessThan(0.5)
  })

  it('stands still in the dead zone in the middle, with the knob still following the thumb', () => {
    const { knob, input } = stickInput(3, -4, 50)
    expect(input).toEqual(STANDING)
    expect(knob).toEqual(near({ x: 3, y: -4 }))
    expect(stickInput(0, 0, 50).input).toEqual(STANDING)
    expect(stickInput(10, 10, 0).input).toEqual(STANDING)
  })
})

describe('turnView', () => {
  it('turns right for a drag to the right and looks up for a drag up, like the mouse', () => {
    const v = turnView({ yaw: 0, pitch: 0 }, 40, -20)
    expect(v.yaw).toBeLessThan(0)
    expect(v.pitch).toBeGreaterThan(0)
  })

  it('stops tilting at the limit, up and down', () => {
    expect(turnView({ yaw: 0, pitch: 0 }, 0, -10000).pitch).toBe(MAX_PITCH)
    expect(turnView({ yaw: 0, pitch: 0 }, 0, 10000).pitch).toBe(-MAX_PITCH)
    // Coming in beyond the limit (the bird's-eye view looked further down) it is pulled back in
    expect(turnView({ yaw: 1, pitch: -1.5 }, 0, 0)).toEqual({ yaw: 1, pitch: -MAX_PITCH })
  })
})

describe('clickSlop', () => {
  it('lets a finger move further than a mouse before a press is a drag', () => {
    expect(clickSlop('mouse')).toBe(4)
    expect(clickSlop('pen')).toBe(4)
    expect(clickSlop('touch')).toBe(10)
  })
})
