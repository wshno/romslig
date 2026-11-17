import type { Page } from '@playwright/test'

import { createProject, expect, projectName, removeProject, test } from './fixtures'

// The phone and tablet layouts. Tagged @mobile: only the `mobile` project (an emulated Pixel 7,
// playwright.config.ts) runs these, and the desktop project leaves them out.

/** Nothing on the page is wider than the window: no sideways scrolling of the page itself. */
async function expectNoSidewaysScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(client)
}

const sheet = (page: Page) => page.getByRole('region', { name: 'Egenskaper' })

test.describe('@mobile phone layout', () => {
  test('the project list fits the phone', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Prosjekter' })).toBeVisible()
    await expectNoSidewaysScroll(page)
  })

  test('the editor fits the phone: plan, bottom sheet, ⋯ menu and views', async ({ page }) => {
    const id = await createProject(page, projectName('mobil'))
    try {
      // The plan gets the width; no columns beside it
      const plan = page.locator('.plan2d')
      await expect(plan).toBeVisible()
      expect((await plan.boundingBox())!.width).toBeGreaterThanOrEqual(300)
      await expect(page.locator('.viewer3d')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '2D + 3D', exact: true })).toHaveCount(0)
      await expect(page.locator('.site-footer')).toBeHidden()
      await expectNoSidewaysScroll(page)

      // The inspector is a bottom sheet: closed with its tabs showing, then half, full and closed again
      const handle = sheet(page).locator('.sheet-handle')
      await expect(sheet(page)).toHaveClass(/\bclosed\b/)
      await expect(sheet(page).getByRole('button', { name: 'Oversikt' })).toBeVisible()
      await expect(handle).toHaveAttribute('aria-expanded', 'false')
      await handle.tap()
      await expect(sheet(page)).toHaveClass(/\bhalf\b/)
      await expect(handle).toHaveAttribute('aria-expanded', 'true')
      await handle.tap()
      await expect(sheet(page)).toHaveClass(/\bfull\b/)
      await handle.tap()
      await expect(sheet(page)).toHaveClass(/\bclosed\b/)

      // A drawing tool from the bottom toolbar; its options get a row above it
      await page.locator('.toolbar button').filter({ hasText: 'Vegg' }).tap()
      await expect(page.getByRole('combobox', { name: 'Tykkelse' })).toBeVisible()
      await page.locator('.toolbar button').filter({ hasText: 'Velg' }).tap()

      // The ⋯ menu holds the variants: make a second one, then switch back to the first
      const more = page.getByRole('button', { name: 'Flere valg' })
      await more.tap()
      const menu = page.getByRole('group', { name: 'Flere valg' })
      page.once('dialog', (d) => void d.accept('Mobilvariant'))
      await menu.getByTitle('Ny variant (kopi av denne)').tap()
      await expect(menu).toBeHidden()
      await more.tap()
      const variant = menu.getByRole('combobox')
      await expect(variant.locator('option:checked')).toHaveText('Mobilvariant')
      await variant.selectOption({ index: 0 })
      await expect(variant.locator('option:checked')).not.toHaveText('Mobilvariant')
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()

      // The view picker goes between 2D and 3D
      await page.getByRole('button', { name: '3D', exact: true }).tap()
      await expect(page.locator('.viewer3d')).toBeVisible()
      await expect(page.locator('.plan2d')).toHaveCount(0)
      await page.getByRole('button', { name: '2D', exact: true }).tap()
      await expect(page.locator('.plan2d')).toBeVisible()
      await expect(page.locator('.viewer3d')).toHaveCount(0)
      await expectNoSidewaysScroll(page)
    } finally {
      await removeProject(page, id)
    }
  })
})

test.describe('@mobile tablet layout', () => {
  test.use({ viewport: { width: 800, height: 1280 } })

  test('the editor keeps its columns, narrower, on a tablet', async ({ page }) => {
    const id = await createProject(page, projectName('nettbrett'))
    try {
      await expect(page.locator('.plan2d')).toBeVisible()
      expect((await page.locator('.toolbar').boundingBox())!.width).toBe(60)
      expect((await page.locator('.inspector').boundingBox())!.width).toBe(260)
      expect((await page.locator('.views').boundingBox())!.width).toBeGreaterThanOrEqual(300)
      // The full top bar, not the phone's ⋯ menu, and no bottom sheet
      await expect(page.getByRole('button', { name: 'Flere valg' })).toHaveCount(0)
      await expect(sheet(page)).toHaveCount(0)
      await expect(page.getByRole('button', { name: '2D + 3D', exact: true })).toBeVisible()
      await expectNoSidewaysScroll(page)
    } finally {
      await removeProject(page, id)
    }
  })
})
