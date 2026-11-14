import type { Scenario } from '@romslig/shared'

/**
 * What is selected in the editor: a list of things, in the order they were selected. Pure helpers
 * for it live here so the store and the 2D/3D views share them.
 */

export type SelectionKind = 'wall' | 'opening' | 'room' | 'furniture' | 'fixture' | 'run' | 'ceiling'
export interface SelectedItem {
  kind: SelectionKind
  id: string
}
export type Selection = readonly SelectedItem[]

/** The empty selection (one shared instance, so it compares equal between renders). */
export const NO_SELECTION: Selection = []

export const isSelected = (sel: Selection, id: string): boolean => sel.some((x) => x.id === id)

/** The selected item when exactly one is selected (the single-item panels and handles), else null. */
export const singleSelected = (sel: Selection): SelectedItem | null => (sel.length === 1 ? sel[0]! : null)

/** The ids of the selected items of one kind, in selection order. */
export const selectedIds = (sel: Selection, kind: SelectionKind): string[] =>
  sel.filter((x) => x.kind === kind).map((x) => x.id)

/** `item` taken out of the selection when it is in it, else added to it. */
export function toggled(sel: Selection, item: SelectedItem): Selection {
  return isSelected(sel, item.id) ? sel.filter((x) => x.id !== item.id) : [...sel, item]
}

/** The selection with `items` added (those already in it are not added twice). */
export function withAdded(sel: Selection, items: readonly SelectedItem[]): Selection {
  const seen = new Set(sel.map((x) => x.id))
  const added = items.filter((x) => {
    if (seen.has(x.id)) return false
    seen.add(x.id)
    return true
  })
  return added.length ? [...sel, ...added] : sel
}

const listOf = (s: Scenario, kind: SelectionKind): readonly { id: string }[] =>
  ({
    wall: s.walls,
    opening: s.openings,
    room: s.rooms,
    furniture: s.furniture,
    fixture: s.fixtures,
    run: s.runs,
    ceiling: s.loweredCeilings,
  })[kind]

/** The selection without the items that are not in `s` (the same array when nothing is missing). */
export function existingIn(sel: Selection, s: Scenario): Selection {
  const kept = sel.filter((x) => listOf(s, x.kind).some((y) => y.id === x.id))
  return kept.length === sel.length ? sel : kept
}

/** Singular and plural Norwegian names of what can be selected (openings by their kind). */
const NAMES = {
  furniture: ['møbel', 'møbler'],
  wall: ['vegg', 'vegger'],
  door: ['dør', 'dører'],
  window: ['vindu', 'vinduer'],
  opening: ['åpning', 'åpninger'],
  room: ['rom', 'rom'],
  fixture: ['punkt', 'punkter'],
  run: ['føring', 'føringer'],
  ceiling: ['nedforet tak', 'nedforede tak'],
} as const

/** A short summary such as "3 valgt: 2 møbler, 1 vindu" (counted in the order above). */
export function selectionSummary(sel: Selection, s: Scenario): string {
  const counts = new Map<keyof typeof NAMES, number>()
  for (const x of sel) {
    const name = x.kind === 'opening' ? (s.openings.find((o) => o.id === x.id)?.kind ?? 'opening') : x.kind
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const parts = (Object.keys(NAMES) as (keyof typeof NAMES)[])
    .filter((k) => counts.has(k))
    .map((k) => {
      const n = counts.get(k)!
      return `${n} ${NAMES[k][n === 1 ? 0 : 1]}`
    })
  return parts.length ? `${sel.length} valgt: ${parts.join(', ')}` : `${sel.length} valgt`
}
