import { describe, expect, it } from 'vitest'
import { clampOpening, fitOpening } from './geometry.ts'
import { DEFAULTS, withOpeningKind, type Opening, type Wall } from './model.ts'

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
