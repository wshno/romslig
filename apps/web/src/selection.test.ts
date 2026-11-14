import { describe, expect, it } from 'vitest'
import { emptyScenario, v, type Scenario } from '@romslig/shared'
import {
  existingIn,
  isSelected,
  NO_SELECTION,
  selectedIds,
  selectionSummary,
  singleSelected,
  toggled,
  withAdded,
  type Selection,
} from './selection.ts'

const sofa = (id: string) => ({
  id,
  catalogId: 'sofa-3',
  x: 0,
  y: 0,
  rotation: 0,
  roomId: null,
  size: null,
  label: null,
})
const opening = (id: string, kind: 'door' | 'window' | 'opening') => ({
  id,
  wallId: 'w',
  kind,
  offset: 1,
  width: 0.8,
  height: 2,
  sill: 0,
  flip: false,
})
const scene: Scenario = {
  ...emptyScenario(),
  walls: [{ id: 'w', a: v(0, 0), b: v(4, 0), thickness: 0.1, height: 2.4, loadBearing: 'unknown', exterior: false }],
  openings: [opening('o1', 'window'), opening('o2', 'window'), opening('o3', 'door')],
  furniture: [sofa('f1'), sofa('f2')],
}

const f1 = { kind: 'furniture', id: 'f1' } as const
const f2 = { kind: 'furniture', id: 'f2' } as const
const w = { kind: 'wall', id: 'w' } as const

describe('selection helpers', () => {
  it('toggles an item in and out', () => {
    const one = toggled(NO_SELECTION, f1)
    expect(one).toEqual([f1])
    const two = toggled(one, w)
    expect(two).toEqual([f1, w])
    expect(toggled(two, f1)).toEqual([w])
  })

  it('adds items once, keeping the array when nothing is new', () => {
    const sel: Selection = [f1]
    expect(withAdded(sel, [f1, f2, f2, w])).toEqual([f1, f2, w])
    expect(withAdded(sel, [f1])).toBe(sel)
  })

  it('gives the single item only when exactly one is selected', () => {
    expect(singleSelected(NO_SELECTION)).toBeNull()
    expect(singleSelected([w])).toBe(w)
    expect(singleSelected([w, f1])).toBeNull()
    expect(isSelected([w, f1], 'f1')).toBe(true)
    expect(isSelected([w], 'f1')).toBe(false)
    expect(selectedIds([f1, w, f2], 'furniture')).toEqual(['f1', 'f2'])
  })

  it('drops items that are not in the variant', () => {
    const sel: Selection = [f1, { kind: 'furniture', id: 'gone' }, w, { kind: 'room', id: 'w' }]
    expect(existingIn(sel, scene)).toEqual([f1, w])
    const all: Selection = [f1, w]
    expect(existingIn(all, scene)).toBe(all)
  })

  it('summarises what is selected in Norwegian', () => {
    expect(
      selectionSummary(
        [f1, { kind: 'opening', id: 'o1' }, f2, { kind: 'opening', id: 'o3' }, { kind: 'opening', id: 'o2' }],
        scene,
      ),
    ).toBe('5 valgt: 2 møbler, 1 dør, 2 vinduer')
    expect(selectionSummary([f1, w], scene)).toBe('2 valgt: 1 møbel, 1 vegg')
  })
})
