import { describe, expect, it } from 'vitest'
import { gridLines, gridSpacing, visibleRect } from './planStyle.ts'

describe('gridSpacing', () => {
  it('picks the finest grid whose lines stay at least 8 px apart', () => {
    expect(gridSpacing(200)).toEqual({ minor: 0.1, major: 1 })
    expect(gridSpacing(80)).toEqual({ minor: 0.1, major: 1 })
    expect(gridSpacing(79)).toEqual({ minor: 0.5, major: 1 })
    expect(gridSpacing(10)).toEqual({ minor: 1, major: 5 })
    expect(gridSpacing(5)).toEqual({ minor: 5, major: 10 })
    expect(gridSpacing(0.1)).toEqual({ minor: 10, major: 50 })
  })
})

describe('visibleRect', () => {
  it('turns the stage offset and scale into world meters', () => {
    expect(visibleRect(800, 400, { scale: 40, x: 100, y: -200 })).toEqual({ x: -2.5, y: 5, width: 20, height: 10 })
  })
})

describe('gridLines', () => {
  it('lists the lines inside the range', () => {
    expect(gridLines(-1.5, 2.2, 1)).toEqual([-1, 0, 1, 2])
  })
  it('leaves out the lines on the major spacing', () => {
    const lines = gridLines(0.85, 2.05, 0.1, 1)
    expect(lines).toHaveLength(10)
    expect(lines.some((x) => Math.abs(x - 1) < 1e-9 || Math.abs(x - 2) < 1e-9)).toBe(false)
  })
})
