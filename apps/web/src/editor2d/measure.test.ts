import { describe, expect, it } from 'vitest'
import { measureAngle, measureDetails, distanceText } from './measure.ts'

describe('distanceText', () => {
  it('shows the distance in meters with a decimal comma', () => {
    expect(distanceText({ x: 1, y: 1 }, { x: 4.5, y: 1 })).toBe('Avstand: 3,50 m')
    expect(distanceText({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe('Avstand: 5,00 m')
  })
})

describe('measureAngle', () => {
  it('is the angle against the horizontal, whichever way the line points', () => {
    expect(measureAngle({ x: 0, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(0)
    expect(measureAngle({ x: 0, y: 0 }, { x: -2, y: 0 })).toBeCloseTo(0)
    expect(measureAngle({ x: 0, y: 0 }, { x: 0, y: -2 })).toBeCloseTo(90)
    expect(measureAngle({ x: 1, y: 1 }, { x: 0, y: 0 })).toBeCloseTo(45)
    expect(measureAngle({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0)
  })
})

describe('measureDetails', () => {
  it('shows Δx, Δy and the angle of a slanted line', () => {
    expect(measureDetails({ x: 0, y: 0 }, { x: 3, y: -1.2 })).toBe('Δx 3,00 m · Δy 1,20 m · 22°')
    expect(measureDetails({ x: 2, y: 2 }, { x: 0, y: 0 })).toBe('Δx 2,00 m · Δy 2,00 m · 45°')
  })
  it('is empty for a straight line across or up and down', () => {
    expect(measureDetails({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe('')
    expect(measureDetails({ x: 0, y: 0 }, { x: 0, y: 2 })).toBe('')
  })
})
