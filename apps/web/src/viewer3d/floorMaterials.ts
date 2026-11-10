import * as THREE from 'three'
import type { Room, RoomType } from '@romslig/shared'

type FloorKind = 'wood' | 'tile' | 'slate' | 'concrete' | 'deck'

/** What the floor is made of in each type of room. */
const FLOOR_KINDS: Record<RoomType, FloorKind> = {
  stue: 'wood',
  kjøkken: 'wood',
  soverom: 'wood',
  gang: 'wood',
  kontor: 'wood',
  annet: 'wood',
  bad: 'tile',
  wc: 'tile',
  vaskerom: 'tile',
  entré: 'slate',
  bod: 'concrete',
  balkong: 'deck',
}

type Paint = (ctx: CanvasRenderingContext2D, rand: () => number) => void

interface Pattern {
  /** Side of the square the texture covers on the floor (m). It repeats beyond that. */
  size: number
  roughness: number
  /** Boards have a direction and are laid along the room. Tiles are not turned. */
  directional: boolean
  paint: Paint
}

/** Pixels along each side of a texture. */
const PX = 512

/** Small seeded generator, so a floor looks the same every time it is drawn. */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`

/** Boards running along y, each column cut into lengths at random places. */
function boards(opts: {
  count: number
  joints: number
  gap: number
  gapColor: string
  color: (rand: () => number) => string
  grain: string
}): Paint {
  return (ctx, rand) => {
    const w = PX / opts.count
    for (let i = 0; i < opts.count; i++) {
      const x = i * w
      const cuts = Array.from({ length: opts.joints }, () => Math.floor(rand() * PX)).sort((a, b) => a - b)
      const first = cuts[0]
      if (first === undefined) {
        ctx.fillStyle = opts.color(rand)
        ctx.fillRect(x, 0, w, PX)
      } else {
        // The last length continues past the edge and comes back in at the top, so the texture repeats without a seam
        cuts.forEach((from, n) => {
          const to = cuts[n + 1] ?? first + PX
          ctx.fillStyle = opts.color(rand)
          ctx.fillRect(x, from, w, to - from)
          ctx.fillRect(x, from - PX, w, to - from)
        })
      }
      ctx.fillStyle = opts.grain
      for (let n = 0; n < 5; n++) ctx.fillRect(x + 2 + rand() * (w - 4), 0, 1, PX)
      ctx.fillStyle = opts.gapColor
      for (const y of cuts) ctx.fillRect(x, y, w, 1)
      ctx.fillRect(x, 0, opts.gap, PX)
    }
  }
}

/** Square tiles with a joint between them. */
function tiles(opts: {
  count: number
  joint: number
  jointColor: string
  color: (rand: () => number) => string
}): Paint {
  return (ctx, rand) => {
    const w = PX / opts.count
    ctx.fillStyle = opts.jointColor
    ctx.fillRect(0, 0, PX, PX)
    for (let i = 0; i < opts.count; i++)
      for (let j = 0; j < opts.count; j++) {
        ctx.fillStyle = opts.color(rand)
        ctx.fillRect(i * w + opts.joint / 2, j * w + opts.joint / 2, w - opts.joint, w - opts.joint)
      }
  }
}

const concrete: Paint = (ctx, rand) => {
  ctx.fillStyle = '#b6b4ae'
  ctx.fillRect(0, 0, PX, PX)
  for (let n = 0; n < 5000; n++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)'
    ctx.fillRect(rand() * PX, rand() * PX, 1 + rand() * 2, 1 + rand() * 2)
  }
}

const PATTERNS: Record<FloorKind, Pattern> = {
  // Oak boards, 18 cm wide
  wood: {
    size: 2.16,
    roughness: 0.7,
    directional: true,
    paint: boards({
      count: 12,
      joints: 2,
      gap: 1,
      gapColor: 'rgba(70, 45, 20, 0.45)',
      color: (rand) => hsl(32 + rand() * 3, 40 + rand() * 5, 56 + rand() * 6),
      grain: 'rgba(110, 75, 35, 0.1)',
    }),
  },
  // Light tiles, 30 cm
  tile: {
    size: 1.2,
    roughness: 0.5,
    directional: false,
    paint: tiles({ count: 4, joint: 3, jointColor: '#8f9694', color: (rand) => hsl(170, 8, 80 + rand() * 4) }),
  },
  // Dark tiles, 60 cm
  slate: {
    size: 2.4,
    roughness: 0.6,
    directional: false,
    paint: tiles({ count: 4, joint: 2, jointColor: '#4b4f52', color: (rand) => hsl(210, 5, 43 + rand() * 4) }),
  },
  concrete: { size: 2, roughness: 0.95, directional: false, paint: concrete },
  // Weathered decking, 12 cm boards with an open gap
  deck: {
    size: 1.2,
    roughness: 0.9,
    directional: true,
    paint: boards({
      count: 10,
      joints: 0,
      gap: 3,
      gapColor: '#4a4038',
      color: (rand) => hsl(28 + rand() * 4, 16 + rand() * 4, 50 + rand() * 8),
      grain: 'rgba(60, 45, 30, 0.12)',
    }),
  },
}

const textures = new Map<string, THREE.Texture>()

function texture(kind: FloorKind, turned: boolean): THREE.Texture {
  const key = `${kind}:${turned}`
  const cached = textures.get(key)
  if (cached) return cached
  const pattern = PATTERNS[kind]
  const canvas = document.createElement('canvas')
  canvas.width = PX
  canvas.height = PX
  const ctx = canvas.getContext('2d')
  if (ctx) pattern.paint(ctx, seeded(kind.length * 7919))
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  // The floor's texture coordinates are in metres
  t.repeat.set(1 / pattern.size, 1 / pattern.size)
  t.rotation = turned ? Math.PI / 2 : 0
  t.anisotropy = 8
  textures.set(key, t)
  return t
}

/** Texture and roughness for the floor of a room. Boards run along the longest side of the room. */
export function floorSurface(room: Pick<Room, 'type' | 'polygon'>): { map: THREE.Texture; roughness: number } {
  const kind = FLOOR_KINDS[room.type]
  const pattern = PATTERNS[kind]
  const xs = room.polygon.map((p) => p.x)
  const ys = room.polygon.map((p) => p.y)
  const wider = Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys)
  return { map: texture(kind, pattern.directional && wider), roughness: pattern.roughness }
}
