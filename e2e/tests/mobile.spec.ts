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
      // No bottom sheet, but the phone's ⋯ menu: the whole bar did not fit and scrolled sideways
      await expect(sheet(page)).toHaveCount(0)
      await expect(page.getByRole('button', { name: '2D + 3D', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Flere valg' })).toBeVisible()
      await expect(page.getByText('Lagret', { exact: true })).toBeVisible()
      const bar = await page.locator('.topbar').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
      expect(bar.scroll).toBeLessThanOrEqual(bar.client)

      // 2D + 3D in an upright views area: one above the other, each the full width
      await page.getByRole('button', { name: '2D + 3D', exact: true }).tap()
      await expect(page.locator('.viewer3d')).toBeVisible()
      const plan2d = (await page.locator('.plan2d').boundingBox())!
      const viewer = (await page.locator('.viewer3d').boundingBox())!
      expect(plan2d.width).toBeGreaterThanOrEqual(400)
      expect(viewer.width).toBeGreaterThanOrEqual(400)
      expect(plan2d.y + plan2d.height).toBeLessThanOrEqual(viewer.y + 1)
      await expectNoSidewaysScroll(page)
    } finally {
      await removeProject(page, id)
    }
  })
})

/** The camera position the viewer writes onto itself, at the walker's eye height (1.6 m). */
const AT_EYE_HEIGHT = /^-?[\d.]+,1\.60,-?[\d.]+$/

test.describe('@mobile 3D on a touch screen', () => {
  test('"Gå rundt" gives a stick, and pushing it walks the camera', async ({ page }) => {
    const id = await createProject(page, projectName('gå'))
    try {
      await page.getByRole('button', { name: '3D', exact: true }).tap()
      const viewer = page.locator('.viewer3d')
      const canvas = viewer.locator('canvas')
      await expect(viewer).toBeVisible()
      // The canvas is closed to the browser's own panning and zooming, in both camera modes
      await expect(canvas).toHaveCSS('touch-action', 'none')

      await viewer.getByRole('button', { name: 'Gå rundt' }).tap()
      const stick = viewer.getByRole('group', { name: 'Styrespak for å gå' })
      await expect(stick).toBeVisible()
      await expect(viewer.locator('.walk-hint')).toContainText('Spaken = gå')
      await expect(canvas).toHaveCSS('touch-action', 'none')

      // The viewer writes the camera position onto itself (data-camera="x,y,z") a few times a second.
      // Wait for the walker's eye height, so the start is the walk's and not the bird's-eye view's.
      await expect(viewer).toHaveAttribute('data-camera', AT_EYE_HEIGHT)
      const start = await viewer.getAttribute('data-camera')

      // A real touch (CDP), not a mouse: the thumb goes down in the middle of the stick, pushes it up
      // and holds it there while the camera walks
      const box = (await stick.boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - box.height / 2 }] })
      await expect.poll(() => viewer.getAttribute('data-camera')).not.toBe(start)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      // Still at eye height: walking does not fly
      await expect(viewer).toHaveAttribute('data-camera', AT_EYE_HEIGHT)

      // "Fugleperspektiv" ends the walk and takes the stick away
      await viewer.getByRole('button', { name: 'Fugleperspektiv' }).tap()
      await expect(stick).toHaveCount(0)
      await expect(viewer.locator('.walk-hint')).toHaveCount(0)
    } finally {
      await removeProject(page, id)
    }
  })
})
