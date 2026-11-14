import { describe, expect, it } from 'vitest'
import { emptyScenario, v, type Scenario } from '@romslig/shared'
import { boxFrom, itemsInBox } from './marquee.ts'

// A 4 m wall along y = 0 with a 1 m window in the middle, a sofa (2.1 × 0.9 m) at (2, 2), a socket,
// a pipe, a room and a lowered ceiling
const scene: Scenario = {
  ...emptyScenario(),
  walls: [{ id: 'w', a: v(0, 0), b: v(4, 0), thickness: 0.1, height: 2.4, loadBearing: 'unknown', exterior: false }],
  openings: [{ id: 'o', wallId: 'w', kind: 'window', offset: 2, width: 1, height: 1.2, sill: 0.9, flip: false }],
  furniture: [{ id: 'f', catalogId: 'sofa-3', x: 2, y: 2, rotation: 0, roomId: null, size: null, label: null }],
  fixtures: [{ id: 'fx', kind: 'outlet', x: 3, y: 3, z: 0.3, wallId: null, label: null, note: null }],
  runs: [
    {
      id: 'run',
      kind: 'water_cold',
      placement: 'floor',
      points: [v(0.5, 3), v(1.5, 3)],
      z: 0,
      diameter: 0.02,
      label: null,
      note: null,
    },
  ],
  rooms: [{ id: 'r', name: 'R', type: 'annet', polygon: [v(0, 0), v(4, 0), v(4, 4), v(0, 4)], statedArea: null }],
  loweredCeilings: [{ id: 'c', polygon: [v(1, 1), v(2, 1), v(2, 2)], height: 2.1, label: null }],
}

const ids = (a: { x: number; y: number }, b: { x: number; y: number }, installations = true) =>
  itemsInBox(scene, boxFrom(a, b), { installations }).map((x) => `${x.kind}:${x.id}`)

describe('boxFrom', () => {
  it('orders the corners', () => {
    expect(boxFrom(v(3, 1), v(1, 4))).toEqual({ x0: 1, y0: 1, x1: 3, y1: 4 })
  })
})

describe('itemsInBox', () => {
  it('catches everything wholly inside, but never rooms or lowered ceilings', () => {
    expect(ids(v(-1, -1), v(5, 5))).toEqual(['wall:w', 'opening:o', 'furniture:f', 'fixture:fx', 'run:run'])
  })

  it('leaves out what only partly lies inside', () => {
    // The sofa reaches from x 0.95 to 3.05: a box to x = 3 cuts it; the wall ends at x = 4
    expect(ids(v(0.5, -1), v(3, 2.5))).toEqual(['opening:o'])
    expect(ids(v(0.9, 1.5), v(3.1, 2.5))).toEqual(['furniture:f'])
  })

  it('catches an opening by the part of the wall it takes up', () => {
    expect(ids(v(1.4, -0.2), v(2.6, 0.2))).toEqual(['opening:o'])
    expect(ids(v(1.6, -0.2), v(2.6, 0.2))).toEqual([])
  })

  it('catches a run only with all its points, and installations only when they are shown', () => {
    expect(ids(v(0, 2.9), v(1, 3.1))).toEqual([])
    expect(ids(v(0, 2.9), v(3.1, 3.1))).toEqual(['fixture:fx', 'run:run'])
    expect(ids(v(0, 2.9), v(3.1, 3.1), false)).toEqual([])
  })
})
