import { describe, expect, it } from 'vitest'
import { doorSwingPolygon } from './furniture.ts'
import { dist, v } from './geometry.ts'
import type { Opening, Wall } from './model.ts'
import { doorLeaf } from './openings.ts'

const wall: Wall = {
  id: 'w',
  a: v(0, 0),
  b: v(4, 0),
  thickness: 0.1,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
}
const door: Opening = { id: 'd', wallId: 'w', kind: 'door', offset: 2, width: 0.9, height: 2.1, sill: 0, flip: false }

describe('doorLeaf', () => {
  it('stands at a right angle to the wall, hinged at the start of the opening', () => {
    const leaf = doorLeaf(door, wall)!
    expect(leaf.hinge.x).toBeCloseTo(1.55)
    expect(leaf.hinge.y).toBeCloseTo(-0.05) // on the face of the wall
    expect(leaf.tip.x).toBeCloseTo(1.55)
    expect(leaf.tip.y).toBeCloseTo(-0.95)
    expect(dist(leaf.hinge, leaf.tip)).toBeCloseTo(0.9)
  })
  it('follows the door to the other side of the wall', () => {
    const leaf = doorLeaf({ ...door, flip: true }, wall)!
    expect(leaf.hinge.y).toBeCloseTo(0.05)
    expect(leaf.tip.y).toBeCloseTo(0.95)
  })
  it('runs along one edge of the square the swing check keeps free', () => {
    for (const flip of [false, true]) {
      for (const w of [wall, { ...wall, a: v(1, 1), b: v(3, 4) }]) {
        const o = { ...door, flip, offset: 1.5 }
        const leaf = doorLeaf(o, w)!
        const swing = doorSwingPolygon(o, w)!
        expect(dist(leaf.hinge, swing[0]!)).toBeCloseTo(0)
        expect(dist(leaf.tip, swing[3]!)).toBeCloseTo(0)
      }
    }
  })
  it('stays inside a wall shorter than the door is wide', () => {
    const short = { ...wall, b: v(0.6, 0) }
    const leaf = doorLeaf(door, short)!
    expect(leaf.hinge.x).toBeCloseTo(0)
    expect(dist(leaf.hinge, leaf.tip)).toBeCloseTo(0.6)
  })
  it('is only for doors', () => {
    expect(doorLeaf({ ...door, kind: 'window' }, wall)).toBeNull()
    expect(doorLeaf({ ...door, kind: 'opening' }, wall)).toBeNull()
  })
})
