import { roomAt } from './furniture.ts'
import { newId, type FurnitureItem, type Project, type Scenario, type Vec2 } from './model.ts'

/**
 * Edits to several furniture items at once (a multi-selection in the editor). Pure: they return a
 * new scenario or project and leave the one they were given untouched.
 */

/**
 * Moves the items in `base` (as they stood when a group drag started) by `delta`, without snapping.
 * Each item gets the room it now stands in. Items in `base` that are no longer in the variant are
 * skipped; items not in `base` stay where they are.
 */
export function moveFurnitureBy(s: Scenario, base: readonly FurnitureItem[], delta: Vec2): Scenario {
  const from = new Map(base.map((f) => [f.id, f]))
  return {
    ...s,
    furniture: s.furniture.map((f) => {
      const b = from.get(f.id)
      if (!b) return f
      const at = { x: b.x + delta.x, y: b.y + delta.y }
      return { ...f, ...at, roomId: roomAt(at, s.rooms)?.id ?? null }
    }),
  }
}

/**
 * Copies of the furniture items `ids` in `s`, moved by `offset`, with new ids and the room each
 * copy stands in. In the variant's order, not the order of `ids`.
 */
export function furnitureCopies(
  s: Scenario,
  ids: readonly string[],
  offset: Vec2 = { x: 0, y: 0 },
  makeId: () => string = () => newId('f_'),
): FurnitureItem[] {
  const wanted = new Set(ids)
  return s.furniture
    .filter((f) => wanted.has(f.id))
    .map((f) => {
      const at = { x: f.x + offset.x, y: f.y + offset.y }
      return { ...f, ...at, id: makeId(), roomId: roomAt(at, s.rooms)?.id ?? null }
    })
}

/**
 * Copies the furniture items `ids` of the variant `fromId` into the variant `toId`, at the same
 * place, with new ids and the rooms of the target variant. Returns the project unchanged (and no
 * copies) when either variant is missing, when they are the same, or when none of the ids is there.
 */
export function copyFurnitureToScenario(
  p: Project,
  fromId: string,
  ids: readonly string[],
  toId: string,
  makeId: () => string = () => newId('f_'),
): { project: Project; copies: FurnitureItem[] } {
  const from = p.scenarios.find((s) => s.id === fromId)
  const to = p.scenarios.find((s) => s.id === toId)
  if (!from || !to || from.id === to.id) return { project: p, copies: [] }
  const copies = furnitureCopies(from, ids, undefined, makeId).map((f) => ({
    ...f,
    roomId: roomAt(f, to.rooms)?.id ?? null,
  }))
  if (!copies.length) return { project: p, copies }
  return {
    project: {
      ...p,
      scenarios: p.scenarios.map((s) => (s.id === toId ? { ...s, furniture: [...s.furniture, ...copies] } : s)),
    },
    copies,
  }
}
