import { describe, expect, it } from 'vitest'
import { cleanLength, parseLength, typedWallEnd } from './wallLength.ts'

describe('parseLength', () => {
  it('reads a length written with a comma or a point', () => {
    expect(parseLength('3,2')).toBeCloseTo(3.2, 9)
    expect(parseLength('3.2')).toBeCloseTo(3.2, 9)
    expect(parseLength('12')).toBe(12)
    expect(parseLength(',5')).toBe(0.5)
    // Half typed: "3," is 3 m so far
    expect(parseLength('3,')).toBe(3)
  })

  it('is NaN for nothing, or for what is not a length', () => {
    for (const text of [null, '', ',', '3,2,1', '3.2.1', 'abc', '-1', '3 m']) expect(parseLength(text)).toBeNaN()
  })
})

describe('cleanLength', () => {
  it('keeps digits and one decimal comma, as the keyboard path does', () => {
    expect(cleanLength('3,2')).toBe('3,2')
    expect(cleanLength('3.2')).toBe('3,2')
    expect(cleanLength('3,2,5')).toBe('3,25')
    expect(cleanLength(' 4 m')).toBe('4')
    expect(cleanLength('-1')).toBe('1')
  })

  it('is null when nothing is left', () => {
    expect(cleanLength('')).toBeNull()
    expect(cleanLength('m')).toBeNull()
  })
})

describe('typedWallEnd', () => {
  const anchor = { x: 1, y: 1 }

  it('goes the typed length toward the aim', () => {
    const end = typedWallEnd(anchor, { x: 1, y: 11 }, 3.2, null)!
    expect(end.x).toBeCloseTo(1)
    expect(end.y).toBeCloseTo(4.2)
  })

  it('with the aim on the anchor (a finger lifted where it placed it), goes straight on, or to the right', () => {
    const on = typedWallEnd(anchor, anchor, 2, { x: 0, y: -1 })!
    expect(on.x).toBeCloseTo(1)
    expect(on.y).toBeCloseTo(-1)
    expect(typedWallEnd(anchor, null, 2, null)).toEqual({ x: 3, y: 1 })
    expect(typedWallEnd(anchor, anchor, 2, null)).toEqual({ x: 3, y: 1 })
  })

  it('is null without a usable length', () => {
    expect(typedWallEnd(anchor, { x: 5, y: 1 }, NaN, null)).toBeNull()
    expect(typedWallEnd(anchor, { x: 5, y: 1 }, 0, null)).toBeNull()
  })
})
