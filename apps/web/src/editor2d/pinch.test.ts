import { describe, expect, it } from 'vitest'
import type { Vec2 } from '@romslig/shared'
import { clampScale, MAX_SCALE, MIN_SCALE, pinchView, zoomAt } from './pinch.ts'

const view = { scale: 40, x: 100, y: 50 }
/** The plan point (metres) under a screen point. */
const worldAt = (v: { scale: number; x: number; y: number }, p: Vec2): Vec2 => ({
  x: (p.x - v.x) / v.scale,
  y: (p.y - v.y) / v.scale,
})
const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

describe('pinchView', () => {
  it('keeps the plan point between the fingers under them while they spread', () => {
    const from: [Vec2, Vec2] = [
      { x: 200, y: 200 },
      { x: 300, y: 200 },
    ]
    const to: [Vec2, Vec2] = [
      { x: 150, y: 200 },
      { x: 350, y: 200 },
    ]
    const next = pinchView(view, from, to)
    const w0 = worldAt(view, mid(...from))
    const w1 = worldAt(next, mid(...to))
    expect(w1.x).toBeCloseTo(w0.x, 9)
    expect(w1.y).toBeCloseTo(w0.y, 9)
  })

  it('scales with the distance between the fingers', () => {
    const from: [Vec2, Vec2] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    expect(
      pinchView(view, from, [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ]).scale,
    ).toBeCloseTo(80, 9)
    expect(
      pinchView(view, from, [
        { x: 25, y: 0 },
        { x: 75, y: 0 },
      ]).scale,
    ).toBeCloseTo(20, 9)
  })

  it('pans with two fingers moved together, without zooming', () => {
    const next = pinchView(
      view,
      [
        { x: 200, y: 200 },
        { x: 300, y: 260 },
      ],
      [
        { x: 230, y: 180 },
        { x: 330, y: 240 },
      ],
    )
    expect(next).toEqual({ scale: 40, x: 130, y: 30 })
  })

  it('stays within the zoom limits of the wheel, and keeps the midpoint fixed there too', () => {
    const from: [Vec2, Vec2] = [
      { x: 190, y: 100 },
      { x: 210, y: 100 },
    ]
    const wide: [Vec2, Vec2] = [
      { x: -5000, y: 100 },
      { x: 5400, y: 100 },
    ]
    const zoomedIn = pinchView(view, from, wide)
    expect(zoomedIn.scale).toBe(MAX_SCALE)
    expect(worldAt(zoomedIn, mid(...wide)).x).toBeCloseTo(worldAt(view, mid(...from)).x, 9)

    const narrow: [Vec2, Vec2] = [
      { x: 200, y: 100 },
      { x: 200.5, y: 100 },
    ]
    expect(
      pinchView(
        view,
        [
          { x: 0, y: 100 },
          { x: 400, y: 100 },
        ],
        narrow,
      ).scale,
    ).toBe(MIN_SCALE)
  })

  it('only pans when the fingers started on the same spot', () => {
    const next = pinchView(
      view,
      [
        { x: 200, y: 200 },
        { x: 200.2, y: 200 },
      ],
      [
        { x: 210, y: 200 },
        { x: 400, y: 200 },
      ],
    )
    expect(next.scale).toBe(40)
    expect(Number.isFinite(next.x) && Number.isFinite(next.y)).toBe(true)
  })

  it('works from the view the gesture started with, so the same fingers give the same view', () => {
    const from: [Vec2, Vec2] = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]
    const to: [Vec2, Vec2] = [
      { x: 80, y: 120 },
      { x: 260, y: 140 },
    ]
    expect(pinchView(view, from, to)).toEqual(pinchView(view, from, to))
    expect(pinchView(view, from, from)).toEqual(view)
  })
})

describe('zoomAt', () => {
  it('keeps the plan point under the pointer and clamps the scale', () => {
    const at = { x: 320, y: 240 }
    const next = zoomAt(view, at, 60)
    expect(next.scale).toBe(60)
    expect(worldAt(next, at).x).toBeCloseTo(worldAt(view, at).x, 9)
    expect(worldAt(next, at).y).toBeCloseTo(worldAt(view, at).y, 9)
    expect(zoomAt(view, at, 10_000).scale).toBe(MAX_SCALE)
    expect(zoomAt(view, at, 1).scale).toBe(MIN_SCALE)
  })

  it('matches the wheel step the plan always had', () => {
    // The formula Plan2D used before it was moved here
    const pointer = { x: 333, y: 111 }
    const world = { x: (pointer.x - view.x) / view.scale, y: (pointer.y - view.y) / view.scale }
    const ns = view.scale * 1.12
    expect(zoomAt(view, pointer, ns)).toEqual({ scale: ns, x: pointer.x - world.x * ns, y: pointer.y - world.y * ns })
  })
})

describe('clampScale', () => {
  it('holds the scale between 5 and 800 px per metre', () => {
    expect(clampScale(4)).toBe(5)
    expect(clampScale(5)).toBe(5)
    expect(clampScale(123)).toBe(123)
    expect(clampScale(900)).toBe(800)
  })
})
