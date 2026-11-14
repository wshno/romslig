import { describe, expect, it } from 'vitest'
import { v } from './geometry.ts'
import { emptyScenario, type FurnitureItem, type Project, type Room, type Scenario } from './model.ts'
import { copyFurnitureToScenario, furnitureCopies, moveFurnitureBy } from './furnitureGroup.ts'

const item = (id: string, x: number, y: number): FurnitureItem => ({
  id,
  catalogId: 'seng-180',
  x,
  y,
  rotation: 90,
  roomId: null,
  size: null,
  label: null,
})

const room = (id: string, x0: number, x1: number): Room => ({
  id,
  name: id,
  type: 'annet',
  polygon: [v(x0, 0), v(x1, 0), v(x1, 4), v(x0, 4)],
  statedArea: null,
})

const scene = (furniture: FurnitureItem[], rooms: Room[] = []): Scenario => ({
  ...emptyScenario(),
  furniture,
  rooms,
})

const counter = () => {
  let n = 0
  return () => `new${++n}`
}

describe('moveFurnitureBy', () => {
  it('moves the given items from where they started, and only those', () => {
    const s = scene([item('a', 1, 1), item('b', 2, 1), item('c', 3, 1)], [room('left', 0, 4), room('right', 4, 8)])
    const base = s.furniture.slice(0, 2)
    // The first step of the drag moved the items already; the result only depends on base + delta
    const once = moveFurnitureBy(s, base, v(1, 0))
    const twice = moveFurnitureBy(once, base, v(2.5, 1))
    expect(twice.furniture.map((f) => [f.id, f.x, f.y, f.roomId])).toEqual([
      ['a', 3.5, 2, 'left'],
      ['b', 4.5, 2, 'right'],
      ['c', 3, 1, null],
    ])
    expect(twice.furniture[0]!.rotation).toBe(90)
    expect(s.furniture[0]!.x).toBe(1)
  })

  it('skips items that are gone', () => {
    const s = scene([item('a', 1, 1)])
    expect(moveFurnitureBy(s, [item('x', 0, 0)], v(1, 1)).furniture).toEqual(s.furniture)
  })
})

describe('furnitureCopies', () => {
  it('copies the items in variant order with new ids, offset, in the room they land in', () => {
    const s = scene([item('a', 1, 1), item('b', 3.9, 1), item('c', 3, 1)], [room('left', 0, 4), room('right', 4, 8)])
    const copies = furnitureCopies(s, ['b', 'a'], v(0.3, 0.3), counter())
    expect(copies.map((f) => [f.id, f.x, f.y, f.roomId, f.rotation])).toEqual([
      ['new1', 1.3, 1.3, 'left', 90],
      ['new2', 4.2, 1.3, 'right', 90],
    ])
  })
})

describe('copyFurnitureToScenario', () => {
  const project = (): Project => {
    const from = { ...scene([item('a', 1, 1), item('b', 5, 1)], [room('left', 0, 4)]), id: 'from' }
    const to = { ...scene([item('z', 2, 2)], [room('big', 0, 8)]), id: 'to' }
    return {
      id: 'p',
      name: 'P',
      planImage: null,
      calibration: { pxPerMeter: 100, calibrated: false },
      ceilingHeight: 2.4,
      northAngle: 0,
      scenarios: [from, to],
      activeScenarioId: 'from',
      chat: [],
      customFurniture: [],
      version: 0,
      createdAt: '',
      updatedAt: '',
    }
  }

  it('adds copies with new ids at the same place, in the rooms of the target variant', () => {
    const p = project()
    const { project: next, copies } = copyFurnitureToScenario(p, 'from', ['a', 'b'], 'to', counter())
    expect(copies.map((f) => f.id)).toEqual(['new1', 'new2'])
    const to = next.scenarios.find((s) => s.id === 'to')!
    expect(to.furniture.map((f) => [f.id, f.x, f.y, f.roomId])).toEqual([
      ['z', 2, 2, null],
      ['new1', 1, 1, 'big'],
      ['new2', 5, 1, 'big'],
    ])
    // The source variant is untouched
    expect(next.scenarios[0]).toBe(p.scenarios[0])
  })

  it('changes nothing for the same variant, a missing variant or unknown ids', () => {
    const p = project()
    expect(copyFurnitureToScenario(p, 'from', ['a'], 'from').project).toBe(p)
    expect(copyFurnitureToScenario(p, 'from', ['a'], 'nope').project).toBe(p)
    expect(copyFurnitureToScenario(p, 'from', ['x'], 'to')).toEqual({ project: p, copies: [] })
  })
})
