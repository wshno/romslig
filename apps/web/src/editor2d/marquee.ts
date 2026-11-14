import {
  add,
  clampOpening,
  footprint,
  getCatalogItem,
  itemSize,
  mul,
  wallDir,
  type Scenario,
  type Vec2,
} from '@romslig/shared'
import type { SelectedItem } from '../selection.ts'

/** An axis-aligned rectangle in plan coordinates (metres), min corner first. */
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The rectangle spanned by two corners, in any order. */
export const boxFrom = (a: Vec2, b: Vec2): Box => ({
  x0: Math.min(a.x, b.x),
  y0: Math.min(a.y, b.y),
  x1: Math.max(a.x, b.x),
  y1: Math.max(a.y, b.y),
})

const inBox = (p: Vec2, r: Box) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1
const allIn = (ps: readonly Vec2[], r: Box) => ps.length > 0 && ps.every((p) => inBox(p, r))

/**
 * What a selection rectangle catches: everything that lies wholly inside it. Furniture by its
 * footprint, walls by their centre line, openings by the stretch of wall they take up, fixtures by
 * their point and runs by all their points; fixtures and runs only when `installations` (they are
 * shown). Rooms and lowered ceilings are areas under everything else, so a rectangle drawn around
 * a part of the plan does not catch them: they are selected by clicking.
 */
export function itemsInBox(s: Scenario, r: Box, { installations }: { installations: boolean }): SelectedItem[] {
  const out: SelectedItem[] = []
  for (const w of s.walls) if (allIn([w.a, w.b], r)) out.push({ kind: 'wall', id: w.id })
  for (const o of s.openings) {
    const w = s.walls.find((x) => x.id === o.wallId)
    if (!w) continue
    const { start, end } = clampOpening(o, w)
    const d = wallDir(w)
    if (allIn([add(w.a, mul(d, start)), add(w.a, mul(d, end))], r)) out.push({ kind: 'opening', id: o.id })
  }
  for (const f of s.furniture)
    if (allIn(footprint(f, itemSize(f, getCatalogItem(f.catalogId))), r)) out.push({ kind: 'furniture', id: f.id })
  if (installations) {
    for (const fx of s.fixtures) if (inBox(fx, r)) out.push({ kind: 'fixture', id: fx.id })
    for (const run of s.runs) if (allIn(run.points, r)) out.push({ kind: 'run', id: run.id })
  }
  return out
}
