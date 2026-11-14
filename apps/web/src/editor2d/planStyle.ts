import { wallFootprint, type Opening, type SnapKind, type Wall } from '@romslig/shared'

export const SNAP_COLORS: Record<SnapKind, string> = {
  endpoint: '#e11d48',
  wall: '#f59e0b',
  angle: '#2563eb',
  grid: '#0d9488',
  none: '#64748b',
}

/** Grid snapping step for the drawing tools, in meters. */
export const SNAP_GRID = 0.1

/** Grid line spacings in meters (minor lines, and the stronger major line), finest first. */
const GRID_STEPS = [
  { minor: 0.1, major: 1 },
  { minor: 0.5, major: 1 },
  { minor: 1, major: 5 },
  { minor: 5, major: 10 },
  { minor: 10, major: 50 },
]

/** The finest grid whose lines are at least `minPx` screen pixels apart at this scale (px per meter). */
export function gridSpacing(scale: number, minPx = 8): { minor: number; major: number } {
  return GRID_STEPS.find((s) => s.minor * scale >= minPx) ?? GRID_STEPS.at(-1)!
}

/** The world rectangle (meters) that a stage of this size shows with this view (stage scale and offset). */
export function visibleRect(
  width: number,
  height: number,
  view: { scale: number; x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  return { x: -view.x / view.scale, y: -view.y / view.scale, width: width / view.scale, height: height / view.scale }
}

/** Positions of the grid lines `step` apart from `from` to `to`, leaving out those on the `skip` spacing. */
export function gridLines(from: number, to: number, step: number, skip?: number): number[] {
  const out: number[] = []
  for (let i = Math.ceil(from / step); i * step <= to; i++) {
    const at = i * step
    if (skip && Math.abs(at / skip - Math.round(at / skip)) < 1e-6) continue
    out.push(at)
  }
  return out
}

export function wallFill(w: Wall, selected: boolean): string {
  if (selected) return '#2563eb'
  return w.loadBearing === 'yes' ? '#7f1d1d' : '#1f2937'
}

export const OPENING_COLORS: Record<Opening['kind'], string> = {
  door: '#92400e',
  window: '#0891b2',
  opening: '#6b7280',
}

/**
 * The wall's outline as flat Konva points, with its corners against `walls` mitred or flush (see
 * `wallFootprint`). Without `walls` the ends are square.
 */
export function wallQuad(
  w: Pick<Wall, 'id' | 'a' | 'b' | 'thickness'>,
  walls: readonly Pick<Wall, 'id' | 'a' | 'b' | 'thickness'>[] = [w],
): number[] {
  return wallFootprint(w, walls).flatMap((p) => [p.x, p.y])
}

export const HINTS: Record<string, string> = {
  select: 'Klikk for å velge. Dra for å panorere, scroll for å zoome.',
  wall: 'Klikk for å starte/fortsette vegg. Skriv lengden (f.eks. 3,2) og trykk Enter. Dobbeltklikk/Esc avslutter. Shift = fri vinkel, Alt = uten rutenett.',
  door: 'Klikk på en vegg for å sette inn en dør.',
  window: 'Klikk på en vegg for å sette inn et vindu.',
  opening: 'Klikk på en vegg for å sette inn en åpning.',
  room: 'Klikk hjørnene i rommet. Klikk på første punkt for å lukke.',
  calibrate: 'Klikk to punkter med kjent avstand (f.eks. en målsatt vegg).',
  fixture: 'Klikk for å plassere. Nær en vegg festes punktet på veggflaten på den siden du klikker.',
  run: 'Klikk punktene langs føringen. Dobbeltklikk eller høyreklikk avslutter. Shift = fri vinkel.',
  ceiling: 'Klikk hjørnene i det nedforede området. Klikk på første punkt for å lukke.',
}
