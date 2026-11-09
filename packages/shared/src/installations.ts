import { z } from 'zod'
import { closestPointOnSegment, dist, lerp, pointInPolygon } from './geometry.ts'
import type { Vec2, Wall } from './model.ts'

/** Plan point (defined here, not imported, to avoid a module cycle with model.ts). */
const Point = z.object({ x: z.number(), y: z.number() })

/**
 * Technical installations: point fixtures (outlets, switches, fuse box, main water valve…),
 * runs (pipes, ducts, cables) and lowered ceilings / boxing-in.
 */

export const FIXTURE_KINDS = [
  'outlet',
  'outlet_double',
  'switch',
  'ceiling_light',
  'wall_light',
  'data',
  'fuse_box',
  'water_inlet',
  'main_valve',
  'drain',
  'vent',
] as const
export const FixtureKind = z.enum(FIXTURE_KINDS)
export type FixtureKind = z.infer<typeof FixtureKind>

export type InstallationCategory = 'electric' | 'water' | 'ventilation'

export interface FixtureInfo {
  name: string
  category: InstallationCategory
  /** Default height above the floor (m). */
  height: number
  /** One or two characters drawn in the plan symbol. */
  symbol: string
}

export const FIXTURE_INFO: Record<FixtureKind, FixtureInfo> = {
  outlet: { name: 'Stikkontakt', category: 'electric', height: 0.3, symbol: 'S' },
  outlet_double: { name: 'Dobbel stikkontakt', category: 'electric', height: 0.3, symbol: 'S2' },
  switch: { name: 'Bryter', category: 'electric', height: 1.1, symbol: 'B' },
  ceiling_light: { name: 'Lampepunkt i tak', category: 'electric', height: 2.4, symbol: 'L' },
  wall_light: { name: 'Vegglampe', category: 'electric', height: 1.8, symbol: 'VL' },
  data: { name: 'Nettverk / TV', category: 'electric', height: 0.3, symbol: 'N' },
  fuse_box: { name: 'Sikringsskap', category: 'electric', height: 1.5, symbol: '⚡' },
  water_inlet: { name: 'Vanninntak', category: 'water', height: 0.2, symbol: 'VI' },
  main_valve: { name: 'Hovedkran (stoppekran)', category: 'water', height: 0.3, symbol: 'HK' },
  drain: { name: 'Sluk', category: 'water', height: 0, symbol: 'Sl' },
  vent: { name: 'Ventil (avtrekk/tilluft)', category: 'ventilation', height: 2.2, symbol: 'V' },
}

export const Fixture = z.object({
  id: z.string(),
  kind: FixtureKind,
  /** Plan position (m). For wall-mounted fixtures: on the wall face. */
  x: z.number(),
  y: z.number(),
  /** Height above the floor (m). */
  z: z.number(),
  /** Wall it is mounted on, if any. */
  wallId: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
})
export type Fixture = z.infer<typeof Fixture>

export const RUN_KINDS = ['water_cold', 'water_hot', 'drain', 'vent_duct', 'electric', 'heating'] as const
export const RunKind = z.enum(RUN_KINDS)
export type RunKind = z.infer<typeof RunKind>

export const RUN_INFO: Record<
  RunKind,
  { name: string; category: InstallationCategory; color: string; diameter: number }
> = {
  water_cold: { name: 'Kaldtvann', category: 'water', color: '#2563eb', diameter: 0.02 },
  water_hot: { name: 'Varmtvann', category: 'water', color: '#dc2626', diameter: 0.02 },
  drain: { name: 'Avløp', category: 'water', color: '#78716c', diameter: 0.11 },
  vent_duct: { name: 'Ventilasjonskanal', category: 'ventilation', color: '#16a34a', diameter: 0.125 },
  electric: { name: 'Elektrisk kabel', category: 'electric', color: '#ca8a04', diameter: 0.02 },
  heating: { name: 'Varme (rør/kabel)', category: 'water', color: '#ea580c', diameter: 0.02 },
}

export const RUN_PLACEMENTS = ['wall', 'floor', 'ceiling', 'lowered_ceiling'] as const
export const RunPlacement = z.enum(RUN_PLACEMENTS)
export type RunPlacement = z.infer<typeof RunPlacement>
export const PLACEMENT_LABELS: Record<RunPlacement, string> = {
  wall: 'I vegg',
  floor: 'I gulv',
  ceiling: 'I himling',
  lowered_ceiling: 'I nedforet tak / innkassing',
}

export const Run = z.object({
  id: z.string(),
  kind: RunKind,
  placement: RunPlacement,
  /** Polyline in plan (m). */
  points: z.array(Point).min(2),
  /** Height of the run above the floor (m). */
  z: z.number(),
  /** Outer diameter (m). */
  diameter: z.number().positive(),
  label: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
})
export type Run = z.infer<typeof Run>

export const LoweredCeiling = z.object({
  id: z.string(),
  polygon: z.array(Point).min(3),
  /** Height of the underside above the floor (m). */
  height: z.number().positive(),
  label: z.string().nullable().default(null),
})
export type LoweredCeiling = z.infer<typeof LoweredCeiling>

/** Default height for a run in a given placement. */
export function defaultRunHeight(placement: RunPlacement, ceilingHeight: number): number {
  switch (placement) {
    case 'floor':
      return 0
    case 'wall':
      return 0.3
    case 'ceiling':
      return ceilingHeight - 0.05
    case 'lowered_ceiling':
      return ceilingHeight - 0.25
  }
}

export function runLength(r: Pick<Run, 'points'>): number {
  let l = 0
  for (let i = 1; i < r.points.length; i++) l += dist(r.points[i - 1]!, r.points[i]!)
  return l
}

/** Is p inside the wall body (with a small tolerance)? */
function inWall(p: Vec2, w: Wall, tol = 0.06): boolean {
  const c = closestPointOnSegment(p, w.a, w.b)
  return c.dist <= w.thickness / 2 + tol && c.t > 0 && c.t < 1
}

/**
 * Installations that would be affected by removing or moving a wall: fixtures mounted on it, and
 * runs laid in walls whose path follows or crosses through it.
 */
export function installationsInWall(
  s: { fixtures: Fixture[]; runs: Run[] },
  w: Wall,
): { fixtures: Fixture[]; runs: Run[] } {
  const fixtures = s.fixtures.filter((f) => f.wallId === w.id || (f.wallId === null && inWall(f, w, 0.03)))
  const runs = s.runs.filter((r) => {
    if (r.placement !== 'wall') return false
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1]!
      const b = r.points[i]!
      // Sample along the segment: any sample inside the wall body means it runs in this wall
      for (let k = 0; k <= 8; k++) if (inWall(lerp(a, b, k / 8), w)) return true
    }
    return false
  })
  return { fixtures, runs }
}

/** Short Norwegian description, e.g. "2 stikkontakter, kaldtvann og avløp". */
export function describeInstallations(found: { fixtures: Fixture[]; runs: Run[] }): string {
  const counts = new Map<string, number>()
  for (const f of found.fixtures)
    counts.set(FIXTURE_INFO[f.kind].name, (counts.get(FIXTURE_INFO[f.kind].name) ?? 0) + 1)
  const parts = [...counts].map(([name, n]) => (n > 1 ? `${n} × ${name.toLowerCase()}` : name.toLowerCase()))
  for (const kind of new Set(found.runs.map((r) => r.kind))) parts.push(RUN_INFO[kind].name.toLowerCase())
  return parts.join(', ')
}

/** Which professional a category of installation needs. */
export const PROFESSIONALS: Record<InstallationCategory, string> = {
  electric: 'autorisert elektriker (NEK 400)',
  water: 'rørlegger',
  ventilation: 'ventilasjonsfagfolk',
}

/** Is the point under a lowered ceiling? Returns the lowest one. */
export function loweredCeilingAt(p: Vec2, ceilings: LoweredCeiling[]): LoweredCeiling | null {
  return ceilings.filter((c) => pointInPolygon(p, c.polygon)).sort((a, b) => a.height - b.height)[0] ?? null
}
