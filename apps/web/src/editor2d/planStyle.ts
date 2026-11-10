import { add, sub, wallDir, type Opening, type SnapKind, type Wall } from '@romslig/shared'

export const SNAP_COLORS: Record<SnapKind, string> = {
  endpoint: '#e11d48',
  wall: '#f59e0b',
  angle: '#2563eb',
  none: '#64748b',
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

export function wallQuad(w: Pick<Wall, 'a' | 'b' | 'thickness'>): number[] {
  const d = wallDir(w)
  const n = { x: -d.y * (w.thickness / 2), y: d.x * (w.thickness / 2) }
  const pts = [add(w.a, n), add(w.b, n), sub(w.b, n), sub(w.a, n)]
  return pts.flatMap((p) => [p.x, p.y])
}

export const HINTS: Record<string, string> = {
  select: 'Klikk for å velge. Dra for å panorere, scroll for å zoome.',
  wall: 'Klikk for å starte/fortsette vegg. Dobbeltklikk/Esc avslutter. Shift = fri vinkel.',
  door: 'Klikk på en vegg for å sette inn en dør.',
  window: 'Klikk på en vegg for å sette inn et vindu.',
  opening: 'Klikk på en vegg for å sette inn en åpning.',
  room: 'Klikk hjørnene i rommet. Klikk på første punkt for å lukke.',
  calibrate: 'Klikk to punkter med kjent avstand (f.eks. en målsatt vegg).',
  fixture: 'Klikk for å plassere. Nær en vegg festes punktet på veggflaten på den siden du klikker.',
  run: 'Klikk punktene langs føringen. Dobbeltklikk eller høyreklikk avslutter. Shift = fri vinkel.',
  ceiling: 'Klikk hjørnene i det nedforede området. Klikk på første punkt for å lukke.',
}
