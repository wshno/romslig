import { describe, expect, it } from 'vitest'
import type { Opening, Room, RoomType, Wall } from './model.ts'
import { ROOM_COLORS } from './roomColors.ts'
import { planThumbnailSvg } from './thumbnail.ts'

const wall = (id: string, ax: number, ay: number, bx: number, by: number, thickness = 0.2): Wall => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
})
const opening = (wallId: string, kind: Opening['kind'], offset: number, width = 0.9): Opening => ({
  id: `${wallId}-${kind}-${offset}`,
  wallId,
  kind,
  offset,
  width,
  height: 2.1,
  sill: 0,
  flip: false,
})
const room = (type: RoomType, polygon: [number, number][]): Room => ({
  id: type,
  name: type,
  type,
  polygon: polygon.map(([x, y]) => ({ x, y })),
  statedArea: null,
})
/** A 6 x 4 m box, walls w1 (top), w2 (right), w3 (bottom), w4 (left). */
const box = () => [wall('w1', 0, 0, 6, 0), wall('w2', 6, 0, 6, 4), wall('w3', 6, 4, 0, 4), wall('w4', 0, 4, 0, 0)]
const paths = (svg: string, stroke: string) =>
  [...svg.matchAll(/<path d="([^"]*)"[^>]*stroke="(#[0-9a-f]+)"/g)].filter((m) => m[2] === stroke).map((m) => m[1]!)

describe('planThumbnailSvg', () => {
  it('draws a dashed frame for a variant with nothing in it', () => {
    const svg = planThumbnailSvg({ walls: [], openings: [], rooms: [] })
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 4 3">/)
    expect(svg).toContain('stroke-dasharray')
    expect(svg).not.toContain('<path')
  })

  it('fits the view box around the walls with a margin', () => {
    const svg = planThumbnailSvg({ walls: box(), openings: [], rooms: [] })
    const [x, y, w, h] = /viewBox="([^"]+)"/.exec(svg)![1]!.split(' ').map(Number)
    expect(x).toBeLessThan(-0.1)
    expect(y).toBeLessThan(-0.1)
    expect(x! + w!).toBeGreaterThan(6.1)
    expect(y! + h!).toBeGreaterThan(4.1)
    expect(w).toBeLessThan(7)
  })

  it('fills each room with the colour of its type, under the walls', () => {
    const svg = planThumbnailSvg({
      walls: box(),
      openings: [],
      rooms: [
        room('bad', [
          [0.1, 0.1],
          [2.9, 0.1],
          [2.9, 3.9],
          [0.1, 3.9],
        ]),
      ],
    })
    expect(svg).toContain(`<polygon points="0.1,0.1 2.9,0.1 2.9,3.9 0.1,3.9" fill="${ROOM_COLORS.bad}"/>`)
    expect(svg.indexOf('<polygon')).toBeLessThan(svg.indexOf('<path'))
    expect(paths(svg, '#334155')).toHaveLength(4)
  })

  it('runs each wall half its thickness past both ends, so corners close', () => {
    const svg = planThumbnailSvg({ walls: [wall('w1', 0, 0, 6, 0)], openings: [], rooms: [] })
    expect(paths(svg, '#334155')).toEqual(['M-0.1,0L6.1,0'])
  })

  it('leaves a gap for a door and for a doorway, and keeps the wall behind a window', () => {
    const svg = planThumbnailSvg({
      walls: box(),
      openings: [opening('w1', 'door', 1.5), opening('w1', 'opening', 4, 1.2), opening('w3', 'window', 3, 1.4)],
      rooms: [],
    })
    const [top, , bottom] = paths(svg, '#334155')
    expect(top).toBe('M-0.1,0L1.05,0M1.95,0L3.4,0M4.6,0L6.1,0')
    expect(bottom).toBe('M6.1,4L-0.1,4')
    // w3 runs from x = 6 to x = 0, so 3 m along it is x = 3
    expect(paths(svg, '#bfdbfe')).toEqual(['M3.7,4L2.3,4'])
  })

  it('ignores an opening on a wall that is gone, and walls without length', () => {
    const svg = planThumbnailSvg({
      walls: [wall('w1', 0, 0, 6, 0), wall('dot', 2, 2, 2, 2)],
      openings: [opening('missing', 'door', 1)],
      rooms: [],
    })
    expect(paths(svg, '#334155')).toEqual(['M-0.1,0L6.1,0'])
  })

  it('keeps thin walls visible in a large plan', () => {
    const svg = planThumbnailSvg({ walls: [wall('w1', 0, 0, 30, 0, 0.05)], openings: [], rooms: [] })
    expect(svg).toContain('stroke-width="0.5"')
  })

  it('lets nothing but numbers and our own colours into the markup', () => {
    const hostile = '"><script>alert(1)</script>'
    const svg = planThumbnailSvg({
      walls: [{ ...wall(hostile, 0, 0, 6, 0), thickness: Number.NaN }, wall('w2', 0, 0, Number.POSITIVE_INFINITY, 4)],
      openings: [{ ...opening(hostile, 'door', 1), id: hostile }],
      rooms: [
        {
          ...room('stue', [
            [0, 0],
            [6, 0],
            [6, 4],
          ]),
          id: hostile,
          name: hostile,
          type: hostile as RoomType,
        },
        {
          ...room('stue', [
            [0, 0],
            [6, 0],
            [6, 4],
          ]),
          type: 'constructor' as RoomType,
        },
      ],
    })
    expect(svg).not.toMatch(/script|NaN|Infinity|function/)
    expect(svg).toMatch(/^<svg [^<>]*>(<(polygon|path) [^<>]*\/>)*<\/svg>$/)
    expect(svg.match(/fill="#e2e8f0"/g)).toHaveLength(2)
  })
})
