import type { CatalogItem, FurnitureCategory, FurnitureShape } from './catalog.ts'
import { CUSTOM_PREFIX } from './catalog.ts'
import { newId, type CustomFurniture } from './model.ts'

/**
 * A new catalog item proposed by photo recognition when nothing in the catalog matches well
 * (e.g. a corner sofa, a bunk bed, a piano).
 */
export interface CatalogProposal {
  /** Norwegian name shown in the app, e.g. "Hjørnesofa". */
  name: string
  /** English name, used for the catalog issue. */
  nameEn: string
  category: FurnitureCategory
  /** Nearest existing 3D shape; a new shape needs code, see the issue. */
  shape: FurnitureShape
  /** Meters. */
  w: number
  d: number
  h: number
  clearance: { front: number; back: number; sides: number }
  /** English description of the real item (form, features), for the catalog issue. */
  descriptionEn: string
  /** Whether a new 3D shape would represent it much better than `shape`. */
  needsNewShape: boolean
}

const CATEGORY_COLORS: Record<FurnitureCategory, string> = {
  stue: '#7d8fa6',
  spis: '#d8b98c',
  soverom: '#e7e1d6',
  kjøkken: '#f1f1ee',
  bad: '#fbfbfa',
  gang: '#d8b98c',
  kontor: '#f1f1ee',
}

/** Turns a proposal into the project's own furniture type. */
export function proposalToCustomFurniture(p: CatalogProposal): CustomFurniture {
  return {
    id: newId(CUSTOM_PREFIX),
    name: p.name,
    category: p.category,
    w: p.w,
    d: p.d,
    h: p.h,
    clearance: p.clearance,
    shape: p.shape,
    color: CATEGORY_COLORS[p.category],
    nameEn: p.nameEn,
    description: p.descriptionEn,
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

/** The catalog entry a maintainer can paste into packages/shared/src/catalog.ts. */
export function catalogEntryFor(
  item: Pick<CustomFurniture, 'name' | 'category' | 'w' | 'd' | 'h' | 'clearance' | 'shape' | 'color'>,
  nameEn: string,
): CatalogItem {
  return {
    id: slug(nameEn) || 'new-item',
    name: item.name,
    category: item.category,
    w: item.w,
    d: item.d,
    h: item.h,
    clearance: item.clearance,
    shape: item.shape,
    color: item.color,
  }
}

/**
 * A prefilled "new issue" link proposing the item for the shared catalog. The issue is written
 * in English and contains no photos; the user reviews and submits it on GitHub.
 */
export function catalogIssueUrl(
  item: Pick<CustomFurniture, 'name' | 'category' | 'w' | 'd' | 'h' | 'clearance' | 'shape' | 'color' | 'description'>,
  opts: { nameEn: string; needsNewShape?: boolean; repo?: string },
): string {
  const repo = opts.repo ?? 'wshno/romslig'
  const cm = (m: number) => Math.round(m * 100)
  const entry = catalogEntryFor(item, opts.nameEn)
  const body = [
    `## Proposed catalog item: ${opts.nameEn}`,
    '',
    item.description || '_No description._',
    '',
    `- Size: ${cm(item.w)} × ${cm(item.d)} × ${cm(item.h)} cm (width × depth × height)`,
    `- Category: \`${item.category}\``,
    `- Nearest existing 3D shape: \`${item.shape}\`${opts.needsNewShape ? ' (a new shape would represent it much better)' : ''}`,
    `- Free space needed: front ${cm(item.clearance.front)} cm, sides ${cm(item.clearance.sides)} cm, back ${cm(item.clearance.back)} cm`,
    '',
    '### Entry for `packages/shared/src/catalog.ts`',
    '',
    '```json',
    JSON.stringify(entry, null, 2),
    '```',
    '',
    '_Proposed from photo recognition in Romslig. Sizes are estimates from photos; adjust to a typical size for the catalog._',
  ].join('\n')
  const params = new URLSearchParams({ title: `catalog: add "${opts.nameEn}"`, body, labels: 'catalog' })
  return `https://github.com/${repo}/issues/new?${params.toString()}`
}
