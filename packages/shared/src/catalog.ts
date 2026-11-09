/**
 * Furniture catalog: real-world sizes (m) and the free space each item needs to be usable.
 * Local frame: width `w` along x, depth `d` along y, front faces +y.
 */

export const FURNITURE_CATEGORIES = ['stue', 'spis', 'soverom', 'kjøkken', 'bad', 'gang', 'kontor'] as const
export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<FurnitureCategory, string> = {
  stue: 'Stue',
  spis: 'Spisestue',
  soverom: 'Soverom',
  kjøkken: 'Kjøkken',
  bad: 'Bad og vaskerom',
  gang: 'Gang',
  kontor: 'Kontor',
}

/** How an item is drawn in 3D. New shapes need code in the 3D view (Furniture3D). */
export const FURNITURE_SHAPES = [
  'box',
  'sofa',
  'armchair',
  'bed',
  'table',
  'chair',
  'cabinet',
  'wardrobe',
  'counter',
  'appliance',
  'wc',
  'sink',
  'shower',
  'bathtub',
  'rug',
  'plant',
  'tv',
] as const
export type FurnitureShape = (typeof FURNITURE_SHAPES)[number]

export interface Clearance {
  /** Free space needed in front (m). */
  front: number
  back: number
  /** Free space needed on each side (m). */
  sides: number
}

export interface CatalogItem {
  id: string
  name: string
  category: FurnitureCategory
  w: number
  d: number
  h: number
  /** Height above the floor of the underside (wall cabinets, wall-mounted TV). */
  elevation?: number
  clearance: Clearance
  shape: FurnitureShape
  color: string
  /** Rugs etc.: never collide. */
  collides?: boolean
  /** Chairs, rugs: may stand in another item's free space (a chair at a table). */
  allowInClearance?: boolean
}

const C = (front = 0, sides = 0, back = 0): Clearance => ({ front, back, sides })

const WOOD = '#b98b5e'
const LIGHT_WOOD = '#d8b98c'
const FABRIC = '#7d8fa6'
const WHITE = '#f1f1ee'
const STEEL = '#c4c8cc'
const GREY = '#8a8f96'

export const CATALOG: CatalogItem[] = [
  // Stue
  {
    id: 'sofa-3',
    name: 'Sofa, 3-seter',
    category: 'stue',
    w: 2.1,
    d: 0.9,
    h: 0.85,
    clearance: C(0.5),
    shape: 'sofa',
    color: FABRIC,
  },
  {
    id: 'sofa-2',
    name: 'Sofa, 2-seter',
    category: 'stue',
    w: 1.6,
    d: 0.9,
    h: 0.85,
    clearance: C(0.5),
    shape: 'sofa',
    color: FABRIC,
  },
  {
    id: 'sofa-4',
    name: 'Sofa, 4-seter',
    category: 'stue',
    w: 2.6,
    d: 0.95,
    h: 0.85,
    clearance: C(0.5),
    shape: 'sofa',
    color: FABRIC,
  },
  {
    id: 'lenestol',
    name: 'Lenestol',
    category: 'stue',
    w: 0.8,
    d: 0.85,
    h: 0.9,
    clearance: C(0.5),
    shape: 'armchair',
    color: FABRIC,
  },
  {
    id: 'salongbord',
    name: 'Salongbord',
    category: 'stue',
    w: 1.2,
    d: 0.6,
    h: 0.45,
    clearance: C(),
    shape: 'table',
    color: LIGHT_WOOD,
    allowInClearance: true,
  },
  {
    id: 'tv-benk',
    name: 'TV-benk',
    category: 'stue',
    w: 1.8,
    d: 0.4,
    h: 0.5,
    clearance: C(0.6),
    shape: 'cabinet',
    color: WOOD,
  },
  {
    id: 'tv-65',
    name: 'TV 65″ (veggmontert)',
    category: 'stue',
    w: 1.45,
    d: 0.06,
    h: 0.84,
    elevation: 0.75,
    clearance: C(),
    shape: 'tv',
    color: '#1f2328',
  },
  {
    id: 'bokhylle',
    name: 'Bokhylle',
    category: 'stue',
    w: 0.8,
    d: 0.3,
    h: 2.0,
    clearance: C(0.5),
    shape: 'cabinet',
    color: WOOD,
  },
  {
    id: 'teppe-200',
    name: 'Teppe 200×300',
    category: 'stue',
    w: 2.0,
    d: 3.0,
    h: 0.01,
    clearance: C(),
    shape: 'rug',
    color: '#c9b79c',
    collides: false,
    allowInClearance: true,
  },
  {
    id: 'plante',
    name: 'Plante',
    category: 'stue',
    w: 0.45,
    d: 0.45,
    h: 1.3,
    clearance: C(),
    shape: 'plant',
    color: '#4f8a4b',
  },

  // Spisestue
  {
    id: 'spisebord-4',
    name: 'Spisebord, 4 pers.',
    category: 'spis',
    w: 1.4,
    d: 0.9,
    h: 0.75,
    clearance: C(0.7, 0.3, 0.7),
    shape: 'table',
    color: LIGHT_WOOD,
  },
  {
    id: 'spisebord-6',
    name: 'Spisebord, 6 pers.',
    category: 'spis',
    w: 2.0,
    d: 1.0,
    h: 0.75,
    clearance: C(0.7, 0.6, 0.7),
    shape: 'table',
    color: LIGHT_WOOD,
  },
  {
    id: 'spisebord-rundt',
    name: 'Rundt bord Ø110',
    category: 'spis',
    w: 1.1,
    d: 1.1,
    h: 0.75,
    clearance: C(0.7, 0.7, 0.7),
    shape: 'table',
    color: LIGHT_WOOD,
  },
  {
    id: 'spisestol',
    name: 'Spisestol',
    category: 'spis',
    w: 0.45,
    d: 0.5,
    h: 0.9,
    clearance: C(0, 0, 0.3),
    shape: 'chair',
    color: WOOD,
    allowInClearance: true,
  },
  {
    id: 'skjenk',
    name: 'Skjenk',
    category: 'spis',
    w: 1.6,
    d: 0.45,
    h: 0.8,
    clearance: C(0.6),
    shape: 'cabinet',
    color: WOOD,
  },

  // Soverom
  {
    id: 'seng-180',
    name: 'Dobbeltseng 180',
    category: 'soverom',
    w: 1.8,
    d: 2.1,
    h: 1.0,
    clearance: C(0.6, 0.6),
    shape: 'bed',
    color: '#e7e1d6',
  },
  {
    id: 'seng-160',
    name: 'Dobbeltseng 160',
    category: 'soverom',
    w: 1.6,
    d: 2.1,
    h: 1.0,
    clearance: C(0.6, 0.6),
    shape: 'bed',
    color: '#e7e1d6',
  },
  {
    id: 'seng-120',
    name: 'Seng 120',
    category: 'soverom',
    w: 1.2,
    d: 2.05,
    h: 0.9,
    clearance: C(0.6, 0.5),
    shape: 'bed',
    color: '#e7e1d6',
  },
  {
    id: 'seng-90',
    name: 'Enkeltseng 90',
    category: 'soverom',
    w: 0.9,
    d: 2.05,
    h: 0.9,
    clearance: C(0.6),
    shape: 'bed',
    color: '#e7e1d6',
  },
  {
    id: 'nattbord',
    name: 'Nattbord',
    category: 'soverom',
    w: 0.45,
    d: 0.4,
    h: 0.5,
    clearance: C(),
    shape: 'cabinet',
    color: WOOD,
    allowInClearance: true,
  },
  {
    id: 'garderobe-100',
    name: 'Garderobeskap 100',
    category: 'soverom',
    w: 1.0,
    d: 0.6,
    h: 2.2,
    clearance: C(0.8),
    shape: 'wardrobe',
    color: WHITE,
  },
  {
    id: 'garderobe-200',
    name: 'Garderobeskap 200',
    category: 'soverom',
    w: 2.0,
    d: 0.6,
    h: 2.2,
    clearance: C(0.8),
    shape: 'wardrobe',
    color: WHITE,
  },
  {
    id: 'kommode',
    name: 'Kommode',
    category: 'soverom',
    w: 0.8,
    d: 0.45,
    h: 0.85,
    clearance: C(0.7),
    shape: 'cabinet',
    color: WHITE,
  },

  // Kjøkken
  {
    id: 'benkeskap-40',
    name: 'Benkeskap 40',
    category: 'kjøkken',
    w: 0.4,
    d: 0.6,
    h: 0.9,
    clearance: C(1.0),
    shape: 'counter',
    color: WHITE,
  },
  {
    id: 'benkeskap-60',
    name: 'Benkeskap 60',
    category: 'kjøkken',
    w: 0.6,
    d: 0.6,
    h: 0.9,
    clearance: C(1.0),
    shape: 'counter',
    color: WHITE,
  },
  {
    id: 'benkeskap-80',
    name: 'Benkeskap 80',
    category: 'kjøkken',
    w: 0.8,
    d: 0.6,
    h: 0.9,
    clearance: C(1.0),
    shape: 'counter',
    color: WHITE,
  },
  {
    id: 'oppvaskmaskin',
    name: 'Oppvaskmaskin',
    category: 'kjøkken',
    w: 0.6,
    d: 0.6,
    h: 0.9,
    clearance: C(1.0),
    shape: 'counter',
    color: STEEL,
  },
  {
    id: 'komfyr',
    name: 'Komfyr / koketopp',
    category: 'kjøkken',
    w: 0.6,
    d: 0.6,
    h: 0.9,
    clearance: C(1.0),
    shape: 'counter',
    color: STEEL,
  },
  {
    id: 'kjoleskap',
    name: 'Kjøleskap',
    category: 'kjøkken',
    w: 0.6,
    d: 0.65,
    h: 1.85,
    clearance: C(1.0),
    shape: 'appliance',
    color: STEEL,
  },
  {
    id: 'hoyskap',
    name: 'Høyskap',
    category: 'kjøkken',
    w: 0.6,
    d: 0.6,
    h: 2.2,
    clearance: C(1.0),
    shape: 'wardrobe',
    color: WHITE,
  },
  {
    id: 'overskap-60',
    name: 'Overskap 60',
    category: 'kjøkken',
    w: 0.6,
    d: 0.35,
    h: 0.7,
    elevation: 1.45,
    clearance: C(),
    shape: 'cabinet',
    color: WHITE,
  },
  {
    id: 'kjokkenoy',
    name: 'Kjøkkenøy',
    category: 'kjøkken',
    w: 1.8,
    d: 0.9,
    h: 0.9,
    clearance: C(1.0, 0, 0.9),
    shape: 'counter',
    color: WHITE,
  },

  // Bad og vaskerom
  {
    id: 'wc',
    name: 'Toalett',
    category: 'bad',
    w: 0.4,
    d: 0.65,
    h: 0.8,
    clearance: C(0.6, 0.2),
    shape: 'wc',
    color: '#fbfbfa',
  },
  {
    id: 'servant',
    name: 'Servant m/skap',
    category: 'bad',
    w: 0.6,
    d: 0.45,
    h: 0.85,
    clearance: C(0.6),
    shape: 'sink',
    color: '#fbfbfa',
  },
  {
    id: 'dusj-90',
    name: 'Dusjhjørne 90×90',
    category: 'bad',
    w: 0.9,
    d: 0.9,
    h: 2.0,
    clearance: C(0.6),
    shape: 'shower',
    color: '#bfe3f2',
  },
  {
    id: 'dusj-80x120',
    name: 'Dusj 80×120',
    category: 'bad',
    w: 1.2,
    d: 0.8,
    h: 2.0,
    clearance: C(0.6),
    shape: 'shower',
    color: '#bfe3f2',
  },
  {
    id: 'badekar',
    name: 'Badekar',
    category: 'bad',
    w: 1.7,
    d: 0.75,
    h: 0.55,
    clearance: C(0.6),
    shape: 'bathtub',
    color: '#fbfbfa',
  },
  {
    id: 'vaskemaskin',
    name: 'Vaskemaskin',
    category: 'bad',
    w: 0.6,
    d: 0.6,
    h: 0.85,
    clearance: C(0.9),
    shape: 'appliance',
    color: WHITE,
  },
  {
    id: 'torketrommel',
    name: 'Tørketrommel',
    category: 'bad',
    w: 0.6,
    d: 0.6,
    h: 0.85,
    clearance: C(0.9),
    shape: 'appliance',
    color: WHITE,
  },
  {
    id: 'speilskap',
    name: 'Speilskap',
    category: 'bad',
    w: 0.6,
    d: 0.15,
    h: 0.7,
    elevation: 1.2,
    clearance: C(),
    shape: 'cabinet',
    color: WHITE,
  },

  // Gang
  {
    id: 'skohylle',
    name: 'Skohylle',
    category: 'gang',
    w: 0.8,
    d: 0.3,
    h: 1.0,
    clearance: C(0.6),
    shape: 'cabinet',
    color: WHITE,
  },
  {
    id: 'gangskap',
    name: 'Garderobeskap, gang',
    category: 'gang',
    w: 1.0,
    d: 0.4,
    h: 2.0,
    clearance: C(0.8),
    shape: 'wardrobe',
    color: WHITE,
  },
  {
    id: 'benk',
    name: 'Benk',
    category: 'gang',
    w: 1.0,
    d: 0.35,
    h: 0.45,
    clearance: C(0.5),
    shape: 'box',
    color: LIGHT_WOOD,
  },

  // Kontor
  {
    id: 'skrivebord',
    name: 'Skrivebord',
    category: 'kontor',
    w: 1.4,
    d: 0.7,
    h: 0.75,
    clearance: C(0.8),
    shape: 'table',
    color: WHITE,
  },
  {
    id: 'kontorstol',
    name: 'Kontorstol',
    category: 'kontor',
    w: 0.6,
    d: 0.6,
    h: 1.1,
    clearance: C(),
    shape: 'chair',
    color: GREY,
    allowInClearance: true,
  },
  {
    id: 'arkivskap',
    name: 'Skuffeseksjon',
    category: 'kontor',
    w: 0.4,
    d: 0.6,
    h: 0.7,
    clearance: C(0.6),
    shape: 'cabinet',
    color: WHITE,
  },
]

export const catalogById: ReadonlyMap<string, CatalogItem> = new Map(CATALOG.map((c) => [c.id, c]))

/** Prefix for the ids of a project's own furniture (not in the built-in catalog). */
export const CUSTOM_PREFIX = 'custom_'
export const isCustomCatalogId = (id: string) => id.startsWith(CUSTOM_PREFIX)

let customById = new Map<string, CatalogItem>()

/**
 * Makes a project's own furniture available to getCatalogItem, so everything that looks items
 * up by id (2D/3D drawing, collision and free-space checks, the AI) handles them like built-ins.
 * Call it whenever the active project changes.
 */
export function setCustomCatalog(items: readonly CatalogItem[]) {
  customById = new Map(items.map((c) => [c.id, c]))
}

export function getCatalogItem(id: string): CatalogItem {
  const c = catalogById.get(id) ?? customById.get(id)
  if (c) return c
  // Unknown id (catalog changed): keep the item visible as a generic box
  return { id, name: id, category: 'stue', w: 0.6, d: 0.6, h: 0.6, clearance: C(), shape: 'box', color: GREY }
}
