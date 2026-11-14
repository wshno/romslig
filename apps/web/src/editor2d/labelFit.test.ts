import { describe, expect, it } from 'vitest'
import { pointInPolygon, v } from '@romslig/shared'
import {
  DIM_MARGIN,
  PLATE_PAD_X,
  ROOM_FONT_MAX,
  ROOM_FONT_MIN,
  edgeLabelFits,
  labelAnchors,
  plateSize,
  rectInPolygon,
  roomLabelLayout,
  textWidth,
} from './labelFit.ts'

const rect = (w: number, h: number) => [v(0, 0), v(w, 0), v(w, h), v(0, h)]
// L-shaped room whose centroid lies outside it
const ell = [v(0, 0), v(4, 0), v(4, 1), v(1, 1), v(1, 4), v(0, 4)]

describe('textWidth', () => {
  it('estimates from the longest line and a per-character factor', () => {
    expect(textWidth('abcd', 10)).toBeCloseTo(24)
    expect(textWidth('ab\nabcd', 10)).toBeCloseTo(24)
    expect(textWidth('abcd', 10, true)).toBeGreaterThan(textWidth('abcd', 10))
    expect(textWidth('', 10)).toBe(0)
  })

  it('counts characters, not UTF-16 units', () => {
    expect(textWidth('m²', 10)).toBeCloseTo(12)
  })
})

describe('plateSize', () => {
  it('adds padding around the text', () => {
    const s = plateSize(['abcd'], 10)
    expect(s.width).toBeCloseTo(24 + 2 * PLATE_PAD_X)
    expect(plateSize(['a', 'b'], 10).height).toBeGreaterThan(plateSize(['a'], 10).height)
  })
})

describe('edgeLabelFits', () => {
  const text = '3,20 m'
  const need = plateSize([text], 11).width + DIM_MARGIN
  it('needs the plate plus a margin along the edge', () => {
    expect(edgeLabelFits(need, text)).toBe(true)
    expect(edgeLabelFits(need - 1, text)).toBe(false)
  })

  it('follows the zoom: a 0.5 m edge fits at 200 px/m but not at 40 px/m', () => {
    expect(edgeLabelFits(0.5 * 200, '0,50 m')).toBe(true)
    expect(edgeLabelFits(0.5 * 40, '0,50 m')).toBe(false)
  })
})

describe('rectInPolygon', () => {
  it('accepts a rectangle well inside and rejects one sticking out', () => {
    expect(rectInPolygon(v(2, 1.5), 1, 1, rect(4, 3))).toBe(true)
    expect(rectInPolygon(v(2, 1.5), 5, 1, rect(4, 3))).toBe(false)
  })

  it('rejects a rectangle that the outline dents into', () => {
    // A notch from the top edge down to (2, 2): the rectangle's corners are all inside the room
    const notched = [v(0, 0), v(4, 0), v(4, 4), v(2.2, 4), v(2, 2), v(1.8, 4), v(0, 4)]
    expect(rectInPolygon(v(2, 2.3), 3, 1, notched)).toBe(false)
    expect(rectInPolygon(v(2, 3), 3, 0.4, notched)).toBe(false)
    expect(rectInPolygon(v(2, 1), 3, 1, notched)).toBe(true)
    expect(rectInPolygon(v(0.5, 2.5), 0.6, 2, ell)).toBe(true)
  })
})

describe('labelAnchors', () => {
  it('starts with the centroid when it is inside', () => {
    expect(labelAnchors(rect(4, 3))[0]).toEqual(v(2, 1.5))
  })

  it('leaves out a centroid outside the room and keeps only inside points', () => {
    const anchors = labelAnchors(ell)
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) expect(pointInPolygon(a, ell)).toBe(true)
  })
})

describe('roomLabelLayout', () => {
  const variants = [['Stue', '12,0 m²'], ['Stue'], ['12,0 m²']]

  it('shows name and area at full size in a roomy room', () => {
    const l = roomLabelLayout(rect(4, 3), variants, 40)!
    expect(l.lines).toEqual(['Stue', '12,0 m²'])
    expect(l.fontSize).toBe(ROOM_FONT_MAX)
    expect(l.at).toEqual(v(2, 1.5))
  })

  it('shrinks the font before dropping lines', () => {
    // 1.4 m × 0.9 m at 40 px/m = 56 × 36 px: two lines fit only at a smaller size
    const l = roomLabelLayout(rect(1.4, 0.9), variants, 40)!
    expect(l.lines).toEqual(['Stue', '12,0 m²'])
    expect(l.fontSize).toBeLessThan(ROOM_FONT_MAX)
    expect(l.fontSize).toBeGreaterThanOrEqual(ROOM_FONT_MIN)
  })

  it('falls back to a single line, then to nothing', () => {
    // 1.4 m × 0.5 m at 40 px/m = 56 × 20 px: one line only
    expect(roomLabelLayout(rect(1.4, 0.5), variants, 40)!.lines).toEqual(['Stue'])
    // Too narrow for the name, wide enough for the area
    expect(
      roomLabelLayout(rect(1.4, 0.5), [['Bad og vaskerom', '3,0 m²'], ['Bad og vaskerom'], ['3,0 m²']], 40)!.lines,
    ).toEqual(['3,0 m²'])
    expect(roomLabelLayout(rect(0.5, 0.5), variants, 40)).toBeNull()
  })

  it('shows more again when zoomed in', () => {
    expect(roomLabelLayout(rect(0.5, 0.5), variants, 200)!.lines).toEqual(['Stue', '12,0 m²'])
  })

  it('places the label inside an L-shaped room, away from the outside centroid', () => {
    const l = roomLabelLayout(ell, variants, 40)!
    expect(l).not.toBeNull()
    expect(pointInPolygon(l.at, ell)).toBe(true)
    expect(rectInPolygon(l.at, l.width / 40, l.height / 40, ell)).toBe(true)
  })

  it('gives up a variant below its own minimum font size', () => {
    const withDev = [{ lines: ['Stue', '12,0 m²', 'oppgitt 11,0 m² (+9 %)'], minFontSize: 12 }, ...variants]
    expect(roomLabelLayout(rect(6, 4), withDev, 40)!.lines).toHaveLength(3)
    const l = roomLabelLayout(rect(2, 1.5), withDev, 40)!
    expect(l.lines).toEqual(['Stue', '12,0 m²'])
    expect(l.fontSize).toBe(ROOM_FONT_MAX)
  })

  it('skips empty variants and degenerate rooms', () => {
    expect(roomLabelLayout(rect(4, 3), [[], ['Stue']], 40)!.lines).toEqual(['Stue'])
    expect(roomLabelLayout([v(0, 0), v(1, 0)], variants, 40)).toBeNull()
  })
})
