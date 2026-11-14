import { describe, expect, it } from 'vitest'
import { pointInPolygon, v } from '@romslig/shared'
import {
  DIM_MARGIN,
  PLATE_PAD_X,
  ROOM_FONT_MAX,
  ROOM_FONT_MIN,
  edgeLabelFits,
  estimateWidth,
  labelAnchors,
  plateSize,
  rectInPolygon,
  rectOverlapsConvex,
  roomLabelLayout,
  styleLine,
  textWidth,
  type Measure,
  type RoomLabelLayout,
} from './labelFit.ts'

const rect = (w: number, h: number) => [v(0, 0), v(w, 0), v(w, h), v(0, h)]
// L-shaped room whose centroid lies outside it
const ell = [v(0, 0), v(4, 0), v(4, 1), v(1, 1), v(1, 4), v(0, 4)]

const line = (text: string, fontSize = 10, bold = false) => ({ text, fontSize, bold })
// A fake measurer: 5 px per character at 10 px, bold 20 % wider
const fake: Measure = (text, fontSize, bold) => [...text].length * fontSize * 0.5 * (bold ? 1.2 : 1)

describe('estimateWidth', () => {
  it('uses a per-character factor, wider for bold, counting characters not UTF-16 units', () => {
    expect(estimateWidth('abcd', 10, false)).toBeCloseTo(24)
    expect(estimateWidth('abcd', 10, true)).toBeGreaterThan(estimateWidth('abcd', 10, false))
    expect(estimateWidth('m²', 10, false)).toBeCloseTo(12)
  })
})

describe('textWidth', () => {
  it('takes the widest line, as the measurer reports it', () => {
    expect(textWidth([line('ab'), line('abcd')], fake)).toBeCloseTo(20)
    expect(textWidth([line('abcd', 10, true)], fake)).toBeCloseTo(24)
    expect(textWidth([line('abcd', 20)], fake)).toBeCloseTo(40)
    expect(textWidth([], fake)).toBe(0)
  })

  it('falls back to the estimate without a measurer', () => {
    expect(textWidth([line('abcd')])).toBeCloseTo(24)
  })
})

describe('styleLine', () => {
  it('resolves plain and scaled lines against the label font', () => {
    expect(styleLine('Stue', 13, true)).toEqual(line('Stue', 13, true))
    expect(styleLine({ text: 'x', size: 0.5, bold: false }, 12, true)).toEqual(line('x', 6, false))
  })
})

describe('plateSize', () => {
  it('adds padding around the measured text', () => {
    expect(plateSize([line('abcd')], 10, fake).width).toBeCloseTo(20 + 2 * PLATE_PAD_X)
    expect(plateSize([line('a'), line('b')], 10, fake).height).toBeGreaterThan(plateSize([line('a')], 10, fake).height)
  })
})

describe('edgeLabelFits', () => {
  const text = '3,20 m'
  const need = plateSize([line(text, 11)], 11, fake).width + DIM_MARGIN
  it('needs the measured plate plus a margin along the edge', () => {
    expect(edgeLabelFits(need, text, 11, fake)).toBe(true)
    expect(edgeLabelFits(need - 1, text, 11, fake)).toBe(false)
  })

  it('follows the zoom: a 0.5 m edge fits at 200 px/m but not at 40 px/m', () => {
    expect(edgeLabelFits(0.5 * 200, '0,50 m')).toBe(true)
    expect(edgeLabelFits(0.5 * 40, '0,50 m')).toBe(false)
  })
})

describe('rectOverlapsConvex', () => {
  const bed = rect(1.6, 2)
  it('detects overlap with a footprint and not with one beside it', () => {
    expect(rectOverlapsConvex(v(0.8, 1), 1, 0.4, bed)).toBe(true)
    expect(rectOverlapsConvex(v(2.5, 1), 1, 0.4, bed)).toBe(false)
    // Touching edge to edge is not overlap
    expect(rectOverlapsConvex(v(2.1, 1), 1, 0.4, bed)).toBe(false)
  })

  it('handles a rotated footprint', () => {
    const diamond = [v(1, 0), v(2, 1), v(1, 2), v(0, 1)]
    // Inside the diamond's bounding box but outside the diamond itself
    expect(rectOverlapsConvex(v(0.15, 0.15), 0.2, 0.2, diamond)).toBe(false)
    expect(rectOverlapsConvex(v(1, 1), 0.2, 0.2, diamond)).toBe(true)
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
  const texts = (l: RoomLabelLayout | null) => l?.lines.map((x) => x.text)
  const variants = [['Stue', '12,0 m²'], ['Stue'], ['12,0 m²']]

  it('shows name and area at full size in a roomy room', () => {
    const l = roomLabelLayout(rect(4, 3), variants, 40)!
    expect(texts(l)).toEqual(['Stue', '12,0 m²'])
    expect(l.fontSize).toBe(ROOM_FONT_MAX)
    expect(l.at).toEqual(v(2, 1.5))
  })

  it('shrinks the font before dropping lines', () => {
    // 1.4 m × 0.9 m at 40 px/m = 56 × 36 px: two lines fit only at a smaller size
    const l = roomLabelLayout(rect(1.4, 0.9), variants, 40)!
    expect(texts(l)).toEqual(['Stue', '12,0 m²'])
    expect(l.fontSize).toBeLessThan(ROOM_FONT_MAX)
    expect(l.fontSize).toBeGreaterThanOrEqual(ROOM_FONT_MIN)
  })

  it('falls back to a single line, then to nothing', () => {
    // 1.4 m × 0.5 m at 40 px/m = 56 × 20 px: one line only
    expect(texts(roomLabelLayout(rect(1.4, 0.5), variants, 40))).toEqual(['Stue'])
    // Too narrow for the name, wide enough for the area
    expect(
      texts(roomLabelLayout(rect(1.4, 0.5), [['Bad og vaskerom', '3,0 m²'], ['Bad og vaskerom'], ['3,0 m²']], 40)),
    ).toEqual(['3,0 m²'])
    expect(roomLabelLayout(rect(0.5, 0.5), variants, 40)).toBeNull()
  })

  it('shows more again when zoomed in', () => {
    expect(texts(roomLabelLayout(rect(0.5, 0.5), variants, 200))).toEqual(['Stue', '12,0 m²'])
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
    expect(texts(l)).toEqual(['Stue', '12,0 m²'])
    expect(l.fontSize).toBe(ROOM_FONT_MAX)
  })

  it('skips empty variants and degenerate rooms', () => {
    expect(texts(roomLabelLayout(rect(4, 3), [[], ['Stue']], 40))).toEqual(['Stue'])
    expect(roomLabelLayout([v(0, 0), v(1, 0)], variants, 40)).toBeNull()
  })

  it('sizes the plate from the measured width', () => {
    const l = roomLabelLayout(rect(4, 3), variants, 40, { measure: fake })!
    expect(l.width).toBeCloseTo(fake('12,0 m²', ROOM_FONT_MAX, true) + 2 * PLATE_PAD_X)
  })

  it('keeps a larger font when the measured text is narrower than the estimate', () => {
    const narrow: Measure = (text, fontSize) => [...text].length * fontSize * 0.4
    expect(roomLabelLayout(rect(1.4, 0.9), variants, 40, { measure: narrow })!.fontSize).toBeGreaterThan(
      roomLabelLayout(rect(1.4, 0.9), variants, 40)!.fontSize,
    )
  })

  it('draws a scaled line at its own size and weight', () => {
    const l = roomLabelLayout(rect(6, 4), [['Stue', { text: 'oppgitt', size: 0.5, bold: false }]], 40)!
    expect(l.lines[1]).toEqual({ text: 'oppgitt', fontSize: ROOM_FONT_MAX * 0.5, bold: false })
  })

  describe('furniture', () => {
    const room = rect(4, 3)
    // Bed in the left half of the room, covering the centroid
    const bed = [v(0.4, 0.5), v(2, 0.5), v(2, 2.5), v(0.4, 2.5)]

    it('moves the label off furniture when there is a free spot', () => {
      expect(roomLabelLayout(room, variants, 40)!.at).toEqual(v(2, 1.5))
      const l = roomLabelLayout(room, variants, 40, { obstacles: [bed] })!
      expect(texts(l)).toEqual(['Stue', '12,0 m²'])
      expect(l.fontSize).toBe(ROOM_FONT_MAX)
      expect(l.overlaps).toBe(false)
      expect(l.at.x).toBeGreaterThan(2)
      expect(rectOverlapsConvex(l.at, l.width / 40, l.height / 40, bed)).toBe(false)
      expect(rectInPolygon(l.at, l.width / 40, l.height / 40, room)).toBe(true)
    })

    it('takes a smaller font in a free spot over full size on top of furniture', () => {
      const wide = [v(0, 0.5), v(2.3, 0.5), v(2.3, 2.5), v(0, 2.5)]
      const l = roomLabelLayout(room, variants, 40, { obstacles: [wide] })!
      expect(texts(l)).toEqual(['Stue', '12,0 m²'])
      expect(l.overlaps).toBe(false)
      expect(l.fontSize).toBeLessThan(ROOM_FONT_MAX)
    })

    it('covers furniture only when no spot is free, keeping the fuller label', () => {
      const big = [v(0.1, 0.1), v(3.9, 0.1), v(3.9, 2.9), v(0.1, 2.9)]
      const l = roomLabelLayout(room, variants, 40, { obstacles: [big] })!
      expect(texts(l)).toEqual(['Stue', '12,0 m²'])
      expect(l.fontSize).toBe(ROOM_FONT_MAX)
      expect(l.overlaps).toBe(true)
      expect(l.at).toEqual(v(2, 1.5))
    })

    it('ignores furniture elsewhere', () => {
      const elsewhere = [v(10, 10), v(11, 10), v(11, 11), v(10, 11)]
      const l = roomLabelLayout(room, variants, 40, { obstacles: [elsewhere] })!
      expect(l.at).toEqual(v(2, 1.5))
      expect(l.overlaps).toBe(false)
    })
  })
})
