import { add, dist, mul, norm, sub, type Vec2 } from '@romslig/shared'

/** Walls shorter than this are not placed from a typed length (a slip, or "0"). */
export const MIN_TYPED_LENGTH = 0.05

/** A typed length in metres, written the Norwegian way ("3,2") or with a point; NaN when it is not one. */
export function parseLength(text: string | null): number {
  const t = text?.replace(',', '.') ?? ''
  if (!/^[\d.]+$/.test(t) || t.split('.').length > 2 || t === '.') return NaN
  return parseFloat(t)
}

/**
 * What the length field keeps of what was typed or pasted into it: digits and one decimal comma (a
 * point becomes a comma, as on the keyboard path), or null when nothing is left.
 */
export function cleanLength(text: string): string | null {
  const kept = text.replace(/\./g, ',').replace(/[^\d,]/g, '')
  const comma = kept.indexOf(',')
  const one = comma < 0 ? kept : kept.slice(0, comma + 1) + kept.slice(comma + 1).replace(/,/g, '')
  return one === '' ? null : one
}

/**
 * Where a wall from `anchor` with a typed length ends: that far toward the aim (the pointer), or,
 * when the aim is on the anchor itself, along `fallback`. A finger is lifted where it placed the
 * last point, so on a phone the aim usually is the anchor: the wall then goes on straight ahead
 * (the chain's last direction), or to the right for the first one. Null without a usable length.
 */
export function typedWallEnd(anchor: Vec2, aim: Vec2 | null, meters: number, fallback: Vec2 | null): Vec2 | null {
  if (Number.isNaN(meters) || meters <= 0) return null
  const dir = aim && dist(anchor, aim) > 1e-6 ? norm(sub(aim, anchor)) : (fallback ?? { x: 1, y: 0 })
  return add(anchor, mul(dir, meters))
}
