import { afterEach, describe, expect, it } from 'vitest'
import { getCatalogItem, isCustomCatalogId, setCustomCatalog } from './catalog.ts'
import { catalogEntryFor, catalogIssueUrl, proposalToCustomFurniture, type CatalogProposal } from './catalogProposal.ts'
import { CustomFurniture } from './model.ts'

const proposal: CatalogProposal = {
  name: 'Hjørnesofa',
  nameEn: 'Corner sofa',
  category: 'stue',
  shape: 'sofa',
  w: 2.6,
  d: 1.6,
  h: 0.85,
  clearance: { front: 0.5, back: 0, sides: 0 },
  descriptionEn: 'L-shaped sofa with a chaise on the right.',
  needsNewShape: true,
}

afterEach(() => setCustomCatalog([]))

describe('custom furniture', () => {
  it('becomes a valid project furniture type with a custom id', () => {
    const item = proposalToCustomFurniture(proposal)
    expect(isCustomCatalogId(item.id)).toBe(true)
    expect(CustomFurniture.parse(item)).toMatchObject({ name: 'Hjørnesofa', w: 2.6, shape: 'sofa' })
  })

  it('is found by getCatalogItem once registered, and falls back to a box otherwise', () => {
    const item = proposalToCustomFurniture(proposal)
    expect(getCatalogItem(item.id).shape).toBe('box')
    setCustomCatalog([item])
    expect(getCatalogItem(item.id)).toMatchObject({ name: 'Hjørnesofa', w: 2.6, d: 1.6 })
    // Built-in items still win
    expect(getCatalogItem('sofa-3').name).toBe('Sofa, 3-seter')
  })
})

describe('catalog issue', () => {
  it('builds an English, prefilled issue link with a pasteable catalog entry', () => {
    const item = proposalToCustomFurniture(proposal)
    const url = new URL(catalogIssueUrl(item, { nameEn: 'Corner sofa', needsNewShape: true }))
    expect(url.origin + url.pathname).toBe('https://github.com/wshno/romslig/issues/new')
    expect(url.searchParams.get('title')).toBe('catalog: add "Corner sofa"')
    expect(url.searchParams.get('labels')).toBe('catalog')
    const body = url.searchParams.get('body')!
    expect(body).toContain('260 × 160 × 85 cm')
    expect(body).toContain('a new shape would represent it much better')
    expect(body).toContain('"id": "corner-sofa"')
    expect(body).not.toMatch(/data:image|base64/)
  })

  it('makes a catalog entry with a slug id from the English name', () => {
    expect(catalogEntryFor(proposalToCustomFurniture(proposal), 'Grand piano (black)').id).toBe('grand-piano-black')
  })
})
