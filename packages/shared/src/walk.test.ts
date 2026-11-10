import { describe, expect, it } from 'vitest'
import { pointInPolygon, v } from './geometry.ts'
import type { Opening, Wall } from './model.ts'
import { WALK_RADIUS, walkBarriers, walkStep } from './walk.ts'

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id,
  a: v(ax, ay),
  b: v(bx, by),
  thickness: 0.1,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
})
const opening = (wallId: string, kind: Opening['kind'], offset: number, extra: Partial<Opening> = {}): Opening => ({
  id: `${wallId}-${kind}-${offset}`,
  wallId,
  kind,
  offset,
  width: 0.9,
  height: 2.1,
  sill: 0,
  flip: false,
  ...extra,
})

/** A 4 × 3 m room with a wall down the middle of a second room to the right: 0..4 and 4..8. */
const walls = [
  wall('t', 0, 0, 8, 0),
  wall('r', 8, 0, 8, 3),
  wall('b', 8, 3, 0, 3),
  wall('l', 0, 3, 0, 0),
  wall('m', 4, 0, 4, 3),
]
/** Closest the middle of a person gets to the centre line of one of these walls. */
const KEEP = 0.05 + WALK_RADIUS

describe('walkBarriers', () => {
  it('is the whole wall when nothing is cut in it', () => {
    const [b, ...rest] = walkBarriers([wall('w', 0, 0, 4, 0)], [])
    expect(rest).toEqual([])
    expect(b).toEqual({ a: v(0, 0), b: v(4, 0), half: 0.05 })
  })
  it('leaves a gap for a door and for a doorway', () => {
    for (const kind of ['door', 'opening'] as const) {
      const bs = walkBarriers([wall('w', 0, 0, 4, 0)], [opening('w', kind, 2)])
      expect(bs.map((b) => [b.a.x, b.b.x])).toEqual([
        [0, 1.55],
        [2.45, 4],
      ])
    }
  })
  it('does not leave a gap for a window, a hatch or a crawl hole', () => {
    const w = wall('w', 0, 0, 4, 0)
    expect(walkBarriers([w], [opening('w', 'window', 2, { sill: 0.9, height: 1.2 })])).toHaveLength(1)
    expect(walkBarriers([w], [opening('w', 'window', 2)])).toHaveLength(1) // glass down to the floor
    expect(walkBarriers([w], [opening('w', 'opening', 2, { sill: 0.9, height: 1 })])).toHaveLength(1)
    expect(walkBarriers([w], [opening('w', 'opening', 2, { height: 1.2 })])).toHaveLength(1)
  })
  it('handles a door at the end of a wall and doors side by side', () => {
    const w = wall('w', 0, 0, 4, 0)
    expect(walkBarriers([w], [opening('w', 'door', 0)]).map((b) => [b.a.x, b.b.x])).toEqual([[0.9, 4]])
    const pair = walkBarriers([w], [opening('w', 'door', 1.45), opening('w', 'door', 2.35)])
    expect(pair).toHaveLength(2)
    expect(pair[0]!.b.x).toBeCloseTo(1)
    expect(pair[1]!.a.x).toBeCloseTo(2.8)
  })
  it('only cuts the wall the opening belongs to', () => {
    expect(walkBarriers(walls, [opening('m', 'door', 1.5)])).toHaveLength(6)
  })
})

describe('walkStep', () => {
  const closed = walkBarriers(walls, [])
  const withDoor = walkBarriers(walls, [opening('m', 'door', 1.5)])

  it('goes where it is told when nothing is in the way', () => {
    expect(walkStep(v(1, 1), v(1.5, 1.2), closed)).toEqual(v(1.5, 1.2))
    expect(walkStep(v(1, 1), v(1, 1), closed)).toEqual(v(1, 1))
    expect(walkStep(v(1, 1), v(3, 2), [])).toEqual(v(3, 2))
  })
  it('stops at a wall', () => {
    const p = walkStep(v(2, 1.5), v(2, -1), closed)
    expect(p.x).toBeCloseTo(2)
    expect(p.y).toBeCloseTo(KEEP)
  })
  it('slides along a wall it meets at an angle', () => {
    const p = walkStep(v(1, 1), v(3, -1), closed)
    expect(p.x).toBeCloseTo(3)
    expect(p.y).toBeCloseTo(KEEP)
  })
  it('stops in a corner', () => {
    const p = walkStep(v(1, 1), v(-2, -2), closed)
    expect(p.x).toBeCloseTo(KEEP)
    expect(p.y).toBeCloseTo(KEEP)
  })
  it('does not jump a wall however long the step', () => {
    expect(walkStep(v(2, 1.5), v(7, 1.5), closed).x).toBeCloseTo(4 - KEEP)
    expect(walkStep(v(2, 1.5), v(40, 1.5), closed).x).toBeCloseTo(4 - KEEP)
  })
  it('walks through a door', () => {
    expect(walkStep(v(2, 1.5), v(6, 1.5), withDoor)).toEqual(v(6, 1.5))
  })
  it('finds the door when it comes at it a little off', () => {
    // Heading for the jamb: pushed sideways into the opening and on through, a little delayed
    const p = walkStep(v(3, 1.2), v(5, 1.2), withDoor)
    expect(p.x).toBeGreaterThan(4.9)
    expect(p.y).toBeGreaterThan(1.2)
    expect(p.y).toBeLessThan(1.5)
  })
  it('does not walk through a window', () => {
    const glass = walkBarriers(walls, [opening('m', 'window', 1.5, { sill: 0.9, height: 1.2 })])
    expect(walkStep(v(2, 1.5), v(6, 1.5), glass).x).toBeCloseTo(4 - KEEP)
  })
  it('does not squeeze through a gap narrower than a person', () => {
    const slit = walkBarriers(walls, [opening('m', 'opening', 1.5, { width: 0.3 })])
    expect(walkStep(v(2, 1.5), v(6, 1.5), slit).x).toBeLessThan(4)
  })
  it('puts a person who starts inside a wall next to it', () => {
    const p = walkStep(v(4, 1.5), v(4, 1.5), closed)
    expect(Math.abs(p.x - 4)).toBeCloseTo(KEEP)
    expect(p.y).toBeCloseTo(1.5)
    const q = walkStep(v(3.98, 1.5), v(3.98, 1.5), closed)
    expect(q.x).toBeCloseTo(4 - KEEP)
  })
  it('keeps a person wandering at random inside the room', () => {
    const room = [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]
    // A fixed sequence, so a failure can be repeated
    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    let p = v(2, 1.5)
    for (let i = 0; i < 3000; i++) {
      const angle = random() * 2 * Math.PI
      const far = random() * 0.6
      p = walkStep(p, v(p.x + Math.cos(angle) * far, p.y + Math.sin(angle) * far), closed)
      expect(pointInPolygon(p, room)).toBe(true)
    }
  })
  it('stays put in a corner too sharp to stand in rather than ending up behind a wall', () => {
    const wedge = walkBarriers([wall('a', 0, 0, 4, 0), wall('b', 0, 0, 4, 0.6)], [])
    const inside = [v(0, 0), v(4, 0), v(4, 0.6)]
    let p = v(3.5, 0.26)
    for (let i = 0; i < 200; i++) {
      p = walkStep(p, v(p.x - 0.1, p.y - 0.015), wedge)
      expect(pointInPolygon(p, inside)).toBe(true)
    }
  })
})
