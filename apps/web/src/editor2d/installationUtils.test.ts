import type { Wall } from '@romslig/shared'
import { describe, expect, it } from 'vitest'
import { CATEGORY_COLORS, fixturePlacement } from './installationUtils.ts'

const wall = (id: string, a: [number, number], b: [number, number], thickness = 0.2): Wall => ({
  id,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  thickness,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
})

const walls = [wall('w1', [0, 0], [4, 0]), wall('w2', [0, 1], [4, 1])]

describe('fixturePlacement', () => {
  it('puts a fixture on the face of the wall, on the side that was clicked', () => {
    const below = fixturePlacement({ x: 2, y: 0.15 }, walls, 0.2, 'outlet')
    expect(below.wallId).toBe('w1')
    expect(below.point.x).toBeCloseTo(2)
    expect(below.point.y).toBeCloseTo(0.11)

    const above = fixturePlacement({ x: 2, y: -0.15 }, walls, 0.2, 'switch')
    expect(above.point.y).toBeCloseTo(-0.11)
  })

  it('picks the nearest wall', () => {
    expect(fixturePlacement({ x: 2, y: 0.8 }, walls, 0.5, 'outlet').wallId).toBe('w2')
  })

  it('leaves the fixture where it was clicked when no wall is close, or past a wall end', () => {
    expect(fixturePlacement({ x: 2, y: 0.5 }, walls, 0.1, 'outlet')).toEqual({ point: { x: 2, y: 0.5 }, wallId: null })
    expect(fixturePlacement({ x: 4.1, y: 0 }, walls, 0.5, 'outlet').wallId).toBeNull()
  })

  it('does not snap ceiling lights and drains', () => {
    expect(fixturePlacement({ x: 2, y: 0.05 }, walls, 0.2, 'ceiling_light')).toEqual({
      point: { x: 2, y: 0.05 },
      wallId: null,
    })
    expect(fixturePlacement({ x: 2, y: 0.05 }, walls, 0.2, 'drain').wallId).toBeNull()
  })

  it('takes a side when the click is exactly on the wall line', () => {
    expect(fixturePlacement({ x: 2, y: 0 }, walls, 0.2, 'outlet').point.y).toBeCloseTo(0.11)
  })

  it('has a colour per category', () => {
    expect(Object.keys(CATEGORY_COLORS)).toEqual(['electric', 'water', 'ventilation'])
  })
})
