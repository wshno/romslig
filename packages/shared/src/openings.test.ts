import { describe, expect, it } from 'vitest'
import { doorSwingNormal, doorSwingPolygon } from './furniture.ts'
import { clampOpening, dist, fitOpening, v } from './geometry.ts'
import { DEFAULTS, emptyScenario, withOpeningKind, type Opening, type Scenario, type Wall } from './model.ts'
import { doorLeaf, moveOpening, openingEndGap, type MoveOpeningOptions } from './openings.ts'

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

describe('moveOpening', () => {
  const mkWall = (id: string, a: [number, number], b: [number, number]): Wall => ({
    ...wall,
    id,
    a: v(...a),
    b: v(...b),
  })
  // A 4 × 3 room (y down: the room lies between y = 0 and y = 3), a slanted wall and a short one
  const walls = [
    mkWall('bottom', [0, 0], [4, 0]),
    mkWall('right', [4, 0], [4, 3]),
    mkWall('top', [4, 3], [0, 3]),
    mkWall('left', [0, 3], [0, 0]),
    mkWall('slant', [6, 0], [9, 4]),
    mkWall('short', [0, 5], [0.5, 5]),
  ]
  const scenario = (o: Opening): Scenario => ({ ...emptyScenario(), walls, openings: [o] })
  const moved = (o: Opening, p: [number, number], opts?: MoveOpeningOptions) =>
    moveOpening(scenario(o), o.id, v(...p), opts).openings[0]!
  const onBottom = door({ wallId: 'bottom', offset: 2 })

  it('slides along its wall to the point, kept inside the wall', () => {
    expect(moved(onBottom, [1.234, 0.02]).offset).toBeCloseTo(1.234)
    expect(moved(onBottom, [10, 0.1]).offset).toBeCloseTo(3.55)
    expect(moved(onBottom, [-3, 0]).offset).toBeCloseTo(0.45)
    // Far from every wall it still follows along its own
    expect(moved(onBottom, [1, 1.5], { switchDist: 0.3 })).toMatchObject({ wallId: 'bottom', offset: 1 })
  })

  it('returns the same scenario when nothing changes', () => {
    const s = scenario(onBottom)
    expect(moveOpening(s, onBottom.id, v(2, 0.1))).toBe(s)
    expect(moveOpening(s, 'missing', v(1, 0))).toBe(s)
  })

  it('rounds the gap to the nearer wall end to the step', () => {
    // Gap to the start 0.784 → 0.8
    expect(moved(onBottom, [1.234, 0], { snapStep: 0.1 }).offset).toBeCloseTo(1.25)
    // Gap to the far end 4 - 3.47 = 0.53 → 0.5
    const nearB = moved(onBottom, [3.02, 0], { snapStep: 0.1 })
    expect(nearB.offset).toBeCloseTo(3.05)
    const g = openingEndGap(nearB, walls[0]!)
    expect(g.end).toBe('b')
    expect(g.gap).toBeCloseTo(0.5)
    expect(g.edge.x).toBeCloseTo(3.5)
  })

  it('goes over to another wall the point comes close to, keeping its size', () => {
    const o = moved(onBottom, [0.1, 1.5], { switchDist: 0.3 })
    expect(o).toMatchObject({ wallId: 'left', width: 0.9, height: 2.1, sill: 0 })
    expect(o.offset).toBeCloseTo(1.5)
    // Without a switch distance it stays on its wall
    expect(moved(onBottom, [0.1, 1.5]).wallId).toBe('bottom')
  })

  it('does not go over to a wall shorter than itself', () => {
    expect(moved(onBottom, [0.25, 5.05], { switchDist: 0.3 }).wallId).toBe('bottom')
    const narrow = door({ kind: 'window', wallId: 'bottom', width: 0.4, sill: 0.9, height: 1.2 })
    const o = moved(narrow, [0.25, 5.05], { switchDist: 0.3 })
    expect(o).toMatchObject({ wallId: 'short', width: 0.4, sill: 0.9, height: 1.2 })
    expect(o.offset).toBeCloseTo(0.25)
  })

  it('works on vertical and slanted walls', () => {
    const onRight = door({ kind: 'window', wallId: 'right', offset: 1.5, width: 1.2 })
    // Along the vertical wall, rounded: gap to the start 0.737 → 0.7
    expect(moved(onRight, [4.05, 1.337], { snapStep: 0.1 }).offset).toBeCloseTo(1.3)
    // Over to the slanted wall (direction 0.6, 0.8) from a point a little to the side of it
    const o = moved(onRight, [7.5 + 0.08, 2 - 0.06], { switchDist: 0.3, snapStep: 0.1 })
    expect(o.wallId).toBe('slant')
    expect(o.offset).toBeCloseTo(2.5)
    // Along the slanted wall, clamped at its end
    expect(moveOpening(scenario(o), o.id, v(20, 20)).openings[0]!.offset).toBeCloseTo(4.4)
  })

  it('keeps a door swinging into the room it swung into, and out when it swung out', () => {
    const swing = (o: Opening) => {
      const n = doorSwingNormal(
        o,
        walls.find((w) => w.id === o.wallId)!,
      )
      return [Math.round(n.x) + 0, Math.round(n.y) + 0]
    }
    const inward = { ...onBottom, flip: true }
    expect(swing(inward)).toEqual([0, 1])
    expect(swing(moved(inward, [0.1, 1.5], { switchDist: 0.3 }))).toEqual([1, 0])
    expect(swing(moved(inward, [2, 2.9], { switchDist: 0.3 }))).toEqual([0, -1])
    expect(swing(moved(inward, [3.9, 1], { switchDist: 0.3 }))).toEqual([-1, 0])
    const outward = { ...onBottom, flip: false }
    expect(swing(outward)).toEqual([0, -1])
    expect(swing(moved(outward, [0.1, 1.5], { switchDist: 0.3 }))).toEqual([-1, 0])
    expect(swing(moved(outward, [2, 2.9], { switchDist: 0.3 }))).toEqual([0, 1])
  })
})
