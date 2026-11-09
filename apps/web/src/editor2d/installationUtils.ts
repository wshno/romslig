import {
  add,
  closestPointOnSegment,
  mul,
  norm,
  sub,
  type FixtureKind,
  type InstallationCategory,
  type Vec2,
  type Wall,
} from '@romslig/shared'

export const CATEGORY_COLORS: Record<InstallationCategory, string> = {
  electric: '#ca8a04',
  water: '#2563eb',
  ventilation: '#16a34a',
}

/** Fixtures that hang in the ceiling or sit in the floor are not snapped to walls. */
const FREE_FIXTURES = new Set<FixtureKind>(['ceiling_light', 'drain'])

/**
 * Where a fixture clicked at p goes: on the face of the nearest wall (the side that was clicked),
 * or at p itself when no wall is close or the kind belongs in the ceiling/floor.
 */
export function fixturePlacement(
  p: Vec2,
  walls: Wall[],
  tolerance: number,
  kind: FixtureKind,
): { point: Vec2; wallId: string | null } {
  if (FREE_FIXTURES.has(kind)) return { point: p, wallId: null }
  let best: { w: Wall; c: Vec2; d: number } | null = null
  for (const w of walls) {
    const c = closestPointOnSegment(p, w.a, w.b)
    const reach = w.thickness / 2 + tolerance
    if (c.dist <= reach && c.t > 0 && c.t < 1 && (!best || c.dist < best.d)) best = { w, c: c.point, d: c.dist }
  }
  if (!best) return { point: p, wallId: null }
  const side = norm(sub(p, best.c))
  const n = side.x === 0 && side.y === 0 ? { x: 0, y: 1 } : side
  return { point: add(best.c, mul(n, best.w.thickness / 2 + 0.01)), wallId: best.w.id }
}
