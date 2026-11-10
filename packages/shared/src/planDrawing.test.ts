import { afterEach, describe, expect, it } from 'vitest'
import { setCustomCatalog } from './catalog.ts'
import { pointInPolygon, polygonCentroid, v } from './geometry.ts'
import type { FurnitureItem, Opening, Room, RoomType, Wall } from './model.ts'
import { furnitureList, labelPoint, planDrawingSvg } from './planDrawing.ts'

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thickness: 0.2,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
})
const opening = (wallId: string, kind: Opening['kind'], offset: number, flip = false): Opening => ({
  id: `${wallId}-${kind}`,
  wallId,
  kind,
  offset,
  width: 0.9,
  height: 2.1,
  sill: 0,
  flip,
})
const room = (
  id: string,
  name: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  type: RoomType = 'stue',
): Room => ({
  id,
  name,
  type,
  polygon: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  statedArea: null,
})
const item = (
  id: string,
  catalogId: string,
  x: number,
  y: number,
  over: Partial<FurnitureItem> = {},
): FurnitureItem => ({
  id,
  catalogId,
  x,
  y,
  rotation: 0,
  roomId: null,
  size: null,
  label: null,
  ...over,
})
/** A room of 4 x 3 m inside, with walls of 20 cm around it: w1 above, w2 right, w3 below, w4 left. */
const walls = () => [
  wall('w1', -0.1, -0.1, 4.1, -0.1),
  wall('w2', 4.1, -0.1, 4.1, 3.1),
  wall('w3', 4.1, 3.1, -0.1, 3.1),
  wall('w4', -0.1, 3.1, -0.1, -0.1),
]
const plan = (over: Partial<Parameters<typeof planDrawingSvg>[0]> = {}) => ({
  walls: walls(),
  openings: [],
  rooms: [room('r1', 'Stue', 0, 0, 4, 3)],
  furniture: [],
  ...over,
})

/** The texts in the drawing, in the order they are drawn. */
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!)

/** Fails unless every tag is closed in order, and no text or attribute holds a stray bracket. */
function expectWellFormed(svg: string) {
  const open: string[] = []
  const chunks = svg.split('<')
  expect(chunks[0]).toBe('')
  for (const chunk of chunks.slice(1)) {
    const end = chunk.indexOf('>')
    expect(end).toBeGreaterThan(0)
    expect(chunk.slice(end + 1)).not.toContain('>')
    const tag = chunk.slice(0, end)
    if (tag.startsWith('/')) {
      expect(open.pop()).toBe(tag.slice(1))
      continue
    }
    const [name, ...attributes] = tag.replace(/\/$/, '').split(/ (?=[a-zA-Z-]+=")/)
    expect(name).toMatch(/^[a-z]+$/)
    for (const a of attributes) expect(a).toMatch(/^[a-zA-Z-]+="[^"]*"$/)
    if (!tag.endsWith('/')) open.push(name!)
  }
  expect(open).toEqual([])
}

afterEach(() => setCustomCatalog([]))

describe('furnitureList', () => {
  const rooms = [room('a', 'Stue', 0, 0, 4, 3), room('b', 'Soverom', 4, 0, 8, 3, 'soverom')]

  it('groups equal items per room, in the order of the rooms, and numbers the rows', () => {
    const list = furnitureList({
      rooms,
      furniture: [
        item('f1', 'nattbord', 5, 1),
        item('f2', 'sofa-3', 1, 1),
        item('f3', 'plante', 20, 20),
        item('f4', 'nattbord', 7, 1, { rotation: 90 }),
        item('f5', 'sofa-3', 1, 2, { label: ' Gammel sofa ' }),
        item('f6', 'nattbord', 6, 2, { size: { w: 0.6, d: 0.4, h: 0.5 } }),
      ],
    })
    expect(list.map((r) => [r.no, r.room, r.name, r.count, r.itemIds])).toEqual([
      [1, 'Stue', 'Sofa, 3-seter', 1, ['f2']],
      [2, 'Stue', 'Gammel sofa', 1, ['f5']],
      [3, 'Soverom', 'Nattbord', 2, ['f1', 'f4']],
      [4, 'Soverom', 'Nattbord', 1, ['f6']],
      [5, null, 'Plante', 1, ['f3']],
    ])
    expect(list[2]).toMatchObject({ w: 0.45, d: 0.4, h: 0.5, roomId: 'b' })
    expect(list[3]).toMatchObject({ w: 0.6 })
    expect(list[4]).toMatchObject({ roomId: null })
  })

  it('goes by where an item stands, not by the room it was once put in', () => {
    const list = furnitureList({ rooms, furniture: [item('f1', 'nattbord', 5, 1, { roomId: 'a' })] })
    expect(list).toMatchObject([{ room: 'Soverom', roomId: 'b' }])
  })

  it('is empty for a variant without furniture', () => {
    expect(furnitureList({ rooms, furniture: [] })).toEqual([])
  })
})

describe('labelPoint', () => {
  it('is the middle of a plain room', () => {
    const r = room('r', 'Stue', 0, 0, 4, 3)
    expect(labelPoint(r.polygon)).toEqual({ x: 2, y: 1.5 })
  })

  it('is inside an L-shaped room, whose middle is not', () => {
    const l = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ].map(([x, y]) => ({ x: x!, y: y! }))
    expect(pointInPolygon(polygonCentroid(l), l)).toBe(false)
    expect(pointInPolygon(labelPoint(l), l)).toBe(true)
  })
})

describe('planDrawingSvg', () => {
  it('says so when the variant has nothing in it', () => {
    const d = planDrawingSvg({ walls: [], openings: [], rooms: [], furniture: [] })
    expect(d).toMatchObject({ width: 4, height: 3 })
    expect(texts(d.svg)).toEqual(['Ingenting er tegnet i denne varianten ennå'])
    expectWellFormed(d.svg)
  })

  it('writes the name and area of the room, the length of its edges and the outer size', () => {
    const d = planDrawingSvg(plan())
    expectWellFormed(d.svg)
    const all = texts(d.svg)
    expect(all).toContain('Stue')
    expect(all).toContain('12,0 m²')
    // Once each: the sides across from them are as long
    expect(all.filter((t) => t === '4,00 m')).toHaveLength(1)
    expect(all.filter((t) => t === '3,00 m')).toHaveLength(1)
    // Wall face to wall face
    expect(all).toContain('4,40 m')
    expect(all).toContain('3,40 m')
    // Scale bar
    expect(all).toContain('1 m')
    // The size on the page follows the plan, in centimetres
    expect(d.width).toBeGreaterThan(4.4)
    expect(d.height).toBeGreaterThan(3.4)
    expect(d.svg).toContain(`width="${Math.round(d.width * 1000) / 10}"`)
  })

  it('writes every side of a room whose sides differ', () => {
    const slanted = { ...room('r1', 'Stue', 0, 0, 4, 3), polygon: [v(0, 0), v(4, 0), v(4, 3), v(1, 3)] }
    const lengths = texts(planDrawingSvg(plan({ walls: [], rooms: [slanted] })).svg).filter((t) => t.endsWith(' m'))
    // The four inside, then the two outside the plan and the scale
    expect(lengths).toEqual(['4,00 m', '3,00 m', '3,00 m', '3,16 m', '4,00 m', '3,00 m', '1 m'])
  })

  it('keeps a furniture number clear of a dimension', () => {
    // A TV on the middle of the upper wall, right where "4,00 m" is written. The lower wall is
    // not as long here, so the length has nowhere else to go.
    const slanted = { ...room('r1', 'Stue', 0, 0, 4, 3), polygon: [v(0, 0), v(4, 0), v(4, 3), v(1, 3)] }
    const tv = [item('f1', 'tv-65', 2, 0.03)]
    const { svg } = planDrawingSvg(plan({ rooms: [slanted], furniture: tv }))
    expect(svg).toMatch(/<text x="200" y="5\.7"[^>]*>4,00 m<\/text>/)
    expect(svg).toMatch(/<text x="156\.5" y="1\.2"[^>]*>1<\/text>/)
    // Nothing to keep clear of without the dimensions
    const bare = planDrawingSvg(plan({ rooms: [slanted], furniture: tv }), { dimensions: false })
    expect(bare.svg).toMatch(/<text x="200" y="3"[^>]*>1<\/text>/)
  })

  it('writes a length on the side that is free of furniture', () => {
    const at = (svg: string) => /<text x="200" y="([\d.]+)"[^>]*>4,00 m<\/text>/.exec(svg)?.[1]
    // Upper side by default, lower side when a TV hangs on the upper one, upper again when both are taken
    expect(at(planDrawingSvg(plan()).svg)).toBe('5.7')
    const upper = item('f1', 'tv-65', 2, 0.03)
    expect(at(planDrawingSvg(plan({ furniture: [upper] })).svg)).toBe('294.3')
    expect(at(planDrawingSvg(plan({ furniture: [upper, item('f2', 'tv-65', 2, 2.97, { rotation: 180 })] })).svg)).toBe(
      '5.7',
    )
    // Furniture that is not drawn does not move anything
    expect(at(planDrawingSvg(plan({ furniture: [upper] }), { furniture: false }).svg)).toBe('5.7')
  })

  it('leaves the dimensions out when asked to, but keeps the scale bar', () => {
    const all = texts(planDrawingSvg(plan(), { dimensions: false }).svg)
    expect(all).toEqual(['Stue', '12,0 m²', '1 m'])
  })

  it('closes the corners, and leaves a gap in the wall for a door', () => {
    const closed = planDrawingSvg(plan()).svg
    // w1 runs 10 cm past both its ends, to the outer face of w4 and w2
    expect(closed).toContain('<path d="M-20,-10L420,-10" stroke-width="20"/>')
    const withDoor = planDrawingSvg(plan({ openings: [opening('w1', 'door', 2.1)] })).svg
    expect(withDoor).toContain('<path d="M-20,-10L155,-10M245,-10L420,-10" stroke-width="20"/>')
    expectWellFormed(withDoor)
  })

  it('draws a door open to the side it swings to', () => {
    const arc = (flip: boolean) => {
      const { svg } = planDrawingSvg(plan({ openings: [opening('w1', 'door', 2.1, flip)] }))
      return /<path d="M(\S+)A90 90 0 0 ([01]) (\S+)"/.exec(svg)!.slice(1)
    }
    // Hinged at x = 155. Not flipped it swings up and out of the room, flipped down and into it.
    expect(arc(false)).toEqual(['155,-110', '1', '245,-20'])
    expect(arc(true)).toEqual(['155,90', '0', '245,0'])
  })

  it('draws windows and doorways in their gaps', () => {
    const { svg } = planDrawingSvg(
      plan({ openings: [opening('w1', 'window', 1), { ...opening('w3', 'opening', 2), id: 'o2' }] }),
    )
    expectWellFormed(svg)
    expect(svg).toContain('<polygon points="45,0 135,0 135,-20 45,-20" fill="#fff"/>')
    expect(svg).toContain('M255,300L165,300M255,320L165,320')
  })

  it('numbers the furniture like the furniture list, and leaves it out when asked to', () => {
    const scenario = plan({
      furniture: [item('f1', 'nattbord', 0.5, 0.5), item('f2', 'sofa-3', 3, 2.4), item('f3', 'nattbord', 3.5, 0.5)],
    })
    const numbers = (svg: string) => texts(svg).filter((t) => /^\d+$/.test(t))
    const drawn = planDrawingSvg(scenario).svg
    expectWellFormed(drawn)
    expect(furnitureList(scenario).map((r) => [r.no, r.name])).toEqual([
      [1, 'Nattbord'],
      [2, 'Sofa, 3-seter'],
    ])
    expect(numbers(drawn)).toEqual(['1', '2', '1'])
    const bare = planDrawingSvg(scenario, { furniture: false }).svg
    expect(numbers(bare)).toEqual([])
    expect(bare.match(/<polygon/g)).toHaveLength(1)
  })

  it('moves the number of a rug out from under what stands on it', () => {
    const { svg } = planDrawingSvg({
      walls: [],
      openings: [],
      rooms: [],
      furniture: [item('sofa', 'sofa-3', 2, 1.5), item('rug', 'teppe-200', 2, 1.5)],
    })
    // The rug is drawn first although it was placed last, and its number sits in a corner of it
    expect(svg).toMatch(/<text x="140" y="60"[^>]*>2<\/text><text x="200" y="150"[^>]*>1<\/text>/)
  })

  it('cannot be made to carry markup by a room name', () => {
    const name = '<script>x</script>&"\'\u0000\u0008\ud800\t!'
    const { svg } = planDrawingSvg(plan({ rooms: [room('r1', name, 0, 0, 4, 3)] }))
    expectWellFormed(svg)
    expect(svg).not.toContain('<script')
    expect(texts(svg)).toContain('&lt;script&gt;x&lt;/script&gt;&amp;&quot;&apos; !')
  })

  it('shortens a long room name', () => {
    const { svg } = planDrawingSvg(plan({ rooms: [room('r1', '𝔸'.repeat(40), 0, 0, 4, 3)] }))
    expect(texts(svg)).toContain(`${'𝔸'.repeat(27)}…`)
  })

  it('only takes plain colours from the furniture types of the project', () => {
    const custom = (id: string, color: string) => ({
      id,
      name: id,
      category: 'stue' as const,
      w: 1,
      d: 1,
      h: 1,
      clearance: { front: 0, back: 0, sides: 0 },
      shape: 'box' as const,
      color,
    })
    setCustomCatalog([
      custom('ok', '#A1b2c3'),
      custom('named', 'tomato'),
      custom('bad', 'red" onload="alert(1)'),
      custom('url', 'url(#x)'),
    ])
    const { svg } = planDrawingSvg({
      walls: [],
      openings: [],
      rooms: [],
      furniture: [item('1', 'ok', 0, 0), item('2', 'named', 2, 0), item('3', 'bad', 4, 0), item('4', 'url', 6, 0)],
    })
    expectWellFormed(svg)
    expect(svg).not.toContain('onload')
    expect(svg).not.toContain('url(')
    expect([...svg.matchAll(/<polygon[^>]* fill="([^"]*)"/g)].map((m) => m[1])).toEqual([
      '#A1b2c3',
      'tomato',
      '#8a8f96',
      '#8a8f96',
    ])
  })

  it('survives numbers and room types that are not what they should be', () => {
    const { svg } = planDrawingSvg(
      plan({
        walls: [...walls(), wall('bad', Number.NaN, 0, 1, 1), wall('point', 1, 1, 1, 1)],
        openings: [opening('gone', 'door', 1)],
        rooms: [room('r1', 'Rom', 0, 0, 4, 3, 'constructor' as RoomType)],
        furniture: [item('f', 'sofa-3', Number.POSITIVE_INFINITY, 0), item('g', 'finnes-ikke', 1, 1)],
      }),
    )
    expectWellFormed(svg)
    expect(svg).not.toMatch(/NaN|Infinity|undefined|function/)
    expect(svg).toContain('fill="#e2e8f0" fill-opacity="0.5"')
  })
})
