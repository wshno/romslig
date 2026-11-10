import { describe, expect, it } from 'vitest'
import { doorSwingPolygon } from './furniture.ts'
import { clampOpening, dist, fitOpening, v } from './geometry.ts'
import { DEFAULTS, withOpeningKind, type Opening, type Wall } from './model.ts'
import { doorLeaf } from './openings.ts'

const wall: Wall = {
  id: 'w',
  a: { x: 1, y: 1 },
  b: { x: 5, y: 1 },
  thickness: 0.1,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
}
const door = (patch: Partial<Opening> = {}): Opening => ({
  id: 'o',
  wallId: 'w',
  kind: 'door',
  offset: 2,
  width: 0.9,
  height: 2.1,
  sill: 0,
  flip: false,
  ...patch,
})

describe('fitOpening', () => {
  it('returns the same opening when it fits', () => {
    const o = door()
    expect(fitOpening(o, wall)).toBe(o)
  })

  it('keeps the opening inside the wall at both ends', () => {
    expect(fitOpening(door({ offset: 9 }), wall).offset).toBeCloseTo(4 - 0.45)
    expect(fitOpening(door({ offset: -3 }), wall).offset).toBeCloseTo(0.45)
    expect(fitOpening(door({ offset: 0.1 }), wall).width).toBeCloseTo(0.9)
  })

  it('makes an opening wider than the wall as wide as the wall', () => {
    const o = fitOpening(door({ width: 6, offset: 1 }), wall)
    expect(o.width).toBe(4)
    expect(o.offset).toBe(2)
  })

  it('moves an opening that was made wider at the end of the wall inwards', () => {
    const o = fitOpening(door({ width: 2, offset: 3.55 }), wall)
    expect(o.offset).toBe(3)
  })

  it('leaves the opening alone in a wall without length', () => {
    const o = door()
    expect(fitOpening(o, { a: { x: 1, y: 1 }, b: { x: 1, y: 1 } })).toBe(o)
  })

  it('agrees with where the opening is drawn', () => {
    const o = door({ offset: 9, width: 1.2 })
    const fitted = fitOpening(o, wall)
    expect(clampOpening(o, wall)).toEqual({
      start: fitted.offset - fitted.width / 2,
      end: fitted.offset + fitted.width / 2,
    })
  })
})

describe('withOpeningKind', () => {
  it('gives a door that becomes a window the sill and height of a window', () => {
    const o = withOpeningKind(door({ width: 1 }), 'window')
    expect(o).toMatchObject({ kind: 'window', sill: DEFAULTS.window.sill, height: DEFAULTS.window.height, width: 1 })
  })

  it('takes a window that becomes a door or an open passage down to the floor', () => {
    const window = door({ kind: 'window', sill: 1.1, height: 0.6 })
    expect(withOpeningKind(window, 'door')).toMatchObject({ kind: 'door', sill: 0, height: DEFAULTS.door.height })
    expect(withOpeningKind(window, 'opening')).toMatchObject({ kind: 'opening', sill: 0, height: 2.1 })
  })

  it('keeps the measures between door and open passage', () => {
    const o = withOpeningKind(door({ height: 2.3 }), 'opening')
    expect(o).toMatchObject({ kind: 'opening', sill: 0, height: 2.3 })
  })

  it('keeps everything else', () => {
    const o = withOpeningKind(door({ flip: true, offset: 3 }), 'window')
    expect(o).toMatchObject({ id: 'o', wallId: 'w', flip: true, offset: 3 })
  })
})

/** A wall from the origin, so the leaf's corners are easy to read. */
const leafWall: Wall = { ...wall, a: v(0, 0), b: v(4, 0) }
const leafDoor = door()

describe('doorLeaf', () => {
  it('stands at a right angle to the wall, hinged at the start of the opening', () => {
    const leaf = doorLeaf(leafDoor, leafWall)!
    expect(leaf.hinge.x).toBeCloseTo(1.55)
    expect(leaf.hinge.y).toBeCloseTo(-0.05) // on the face of the wall
    expect(leaf.tip.x).toBeCloseTo(1.55)
    expect(leaf.tip.y).toBeCloseTo(-0.95)
    expect(dist(leaf.hinge, leaf.tip)).toBeCloseTo(0.9)
  })
  it('follows the door to the other side of the wall', () => {
    const leaf = doorLeaf({ ...leafDoor, flip: true }, leafWall)!
    expect(leaf.hinge.y).toBeCloseTo(0.05)
    expect(leaf.tip.y).toBeCloseTo(0.95)
  })
  it('runs along one edge of the square the swing check keeps free', () => {
    for (const flip of [false, true]) {
      for (const w of [leafWall, { ...leafWall, a: v(1, 1), b: v(3, 4) }]) {
        const o = { ...leafDoor, flip, offset: 1.5 }
        const leaf = doorLeaf(o, w)!
        const swing = doorSwingPolygon(o, w)!
        expect(dist(leaf.hinge, swing[0]!)).toBeCloseTo(0)
        expect(dist(leaf.tip, swing[3]!)).toBeCloseTo(0)
      }
    }
  })
  it('stays inside a wall shorter than the door is wide', () => {
    const short = { ...leafWall, b: v(0.6, 0) }
    const leaf = doorLeaf(leafDoor, short)!
    expect(leaf.hinge.x).toBeCloseTo(0)
    expect(dist(leaf.hinge, leaf.tip)).toBeCloseTo(0.6)
  })
  it('is only for doors', () => {
    expect(doorLeaf({ ...leafDoor, kind: 'window' }, leafWall)).toBeNull()
    expect(doorLeaf({ ...leafDoor, kind: 'opening' }, leafWall)).toBeNull()
  })
})
