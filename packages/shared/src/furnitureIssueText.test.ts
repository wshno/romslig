import { describe, expect, it } from 'vitest'
import { catalogById } from './catalog.ts'
import { describeFurnitureIssue, findFreeSpot, type FurnitureIssue } from './furniture.ts'
import { defaultRunHeight } from './installations.ts'
import { v } from './geometry.ts'
import type { FurnitureItem, Room } from './model.ts'

const item = (id: string, catalogId: string, label: string | null = null): FurnitureItem => ({
  id,
  catalogId,
  x: 0,
  y: 0,
  rotation: 0,
  roomId: null,
  size: null,
  label,
})

const scenario = { furniture: [item('f_sofa', 'sofa-3'), item('f_bord', 'salongbord', 'Spisebordet')] }
const text = (issue: FurnitureIssue, catalogId = 'sofa-3') => describeFurnitureIssue(issue, scenario, catalogId)

describe('describeFurnitureIssue', () => {
  it('names the other item by its label, its catalog name, or as a piece of furniture', () => {
    expect(text({ kind: 'overlap', otherId: 'f_bord' })).toBe('Kolliderer med «Spisebordet»')
    expect(text({ kind: 'overlap', otherId: 'f_sofa' })).toBe(`Kolliderer med «${catalogById.get('sofa-3')!.name}»`)
    expect(text({ kind: 'overlap', otherId: 'f_gone' })).toBe('Kolliderer med «et møbel»')
  })

  it('describes walls, doors, passages, windows, ceilings and items outside the rooms', () => {
    expect(text({ kind: 'wall', wallId: 'w' })).toBe('Står inni en vegg')
    expect(text({ kind: 'door', openingId: 'o' })).toBe('Står i slagfeltet til en dør')
    expect(text({ kind: 'passage', openingId: 'o', of: 'door' })).toBe('Står i veien foran en dør')
    expect(text({ kind: 'passage', openingId: 'o', of: 'opening' })).toBe('Står i veien i en åpning mellom rom')
    expect(text({ kind: 'window', openingId: 'o' })).toBe('Dekker mer enn halve vinduet')
    expect(text({ kind: 'ceiling', ceilingId: 'c', height: 2.104 })).toBe(
      'Rekker opp i nedforet tak (210 cm over gulvet)',
    )
    expect(text({ kind: 'outside' })).toBe('Står utenfor rommene')
  })

  it('says how much free space is needed on which side, and what blocks it', () => {
    const c = catalogById.get('sofa-3')!.clearance
    expect(text({ kind: 'clearance', side: 'front', blockedBy: { wallId: 'w' } })).toBe(
      `For lite fri plass foran (trenger ${Math.round(c.front * 100)} cm), blokkert av en vegg`,
    )
    expect(text({ kind: 'clearance', side: 'left', blockedBy: { furnitureId: 'f_bord' } })).toBe(
      `For lite fri plass til venstre (trenger ${Math.round(c.sides * 100)} cm), blokkert av «Spisebordet»`,
    )
    expect(text({ kind: 'clearance', side: 'back', blockedBy: { wallId: 'w' } })).toMatch(/^For lite fri plass bak/)
    expect(text({ kind: 'clearance', side: 'right', blockedBy: { wallId: 'w' } })).toMatch(/til høyre/)
  })
})

describe('findFreeSpot', () => {
  it('finds nothing in a room without an outline', () => {
    const room: Room = { id: 'r', name: 'Strek', type: 'annet', polygon: [v(0, 0), v(1, 0)], statedArea: null }
    expect(findFreeSpot({ furniture: [], walls: [], openings: [], rooms: [room] }, 'sofa-3', room)).toBeNull()
  })
})

describe('defaultRunHeight', () => {
  it('puts a run on the floor, low on the wall, under the ceiling or above a lowered one', () => {
    expect(defaultRunHeight('floor', 2.4)).toBe(0)
    expect(defaultRunHeight('wall', 2.4)).toBeCloseTo(0.3)
    expect(defaultRunHeight('ceiling', 2.4)).toBeCloseTo(2.35)
    expect(defaultRunHeight('lowered_ceiling', 2.4)).toBeCloseTo(2.15)
  })
})
