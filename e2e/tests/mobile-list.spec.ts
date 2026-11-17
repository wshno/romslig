import type { Locator, Page } from '@playwright/test'

import { createProject, expect, projectName, removeProject, test } from './fixtures'

// The project list, the catalog, the assistant and the error toast on a phone (M6). Tagged @mobile:
// only the `mobile` project (an emulated Pixel 7, 412 px wide with a touch screen,
// playwright.config.ts) runs these.

/** Nothing on the page is wider than the window: no sideways scrolling of the page itself. */
async function expectNoSidewaysScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(client)
}

/** The element lies inside the window, left to right. */
async function expectWithinWidth(page: Page, el: Locator) {
  const box = (await el.boundingBox())!
  const width = page.viewportSize()!.width
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(width)
}

/** What is drawn at the middle of the element is the element (or inside it): nothing lies over it. */
async function expectOnTop(el: Locator) {
  expect(
    await el.evaluate((node) => {
      const r = node.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return top !== null && node.contains(top)
    }),
  ).toBe(true)
}

const sheet = (page: Page) => page.getByRole('region', { name: 'Egenskaper' })

test.describe('@mobile project list on a phone', () => {
  test('the new-project form fits, and a long name neither widens the page nor crowds out the actions', async ({
    page,
  }) => {
    await page.goto('/')
    const form = page.locator('form.new-project')
    await expect(form).toBeVisible()
    await expectWithinWidth(page, form.getByPlaceholder('Min leilighet'))
    await expectWithinWidth(page, form.locator('input[type="file"]'))
    await expectWithinWidth(page, form.getByRole('button', { name: 'Opprett prosjekt' }))
    await expectNoSidewaysScroll(page)

    // One long word, the kind that does not wrap by itself
    const name = projectName('Oppussingsprosjektetforleilighetenpågrünerløkka'.repeat(2))
    const id = await createProject(page, name)
    try {
      await page.goto('/')
      const item = page.locator('.project-list li').filter({ has: page.getByRole('link', { name }) })
      await expect(item).toBeVisible()
      await expectNoSidewaysScroll(page)
      await expectWithinWidth(page, item)

      // The actions are links to look at, but finger-sized to hit
      for (const label of ['Gi nytt navn', 'Kopier', 'Eksporter', 'Slett']) {
        const action = item.getByRole('button', { name: label, exact: true })
        await expectWithinWidth(page, action)
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }

      // Renaming gets a field wide enough to type in, on a line of its own
      await item.getByRole('button', { name: 'Gi nytt navn', exact: true }).tap()
      const field = page.getByRole('textbox', { name: 'Nytt navn' })
      await expect(field).toBeFocused()
      expect((await field.boundingBox())!.width).toBeGreaterThanOrEqual(150)
      await expectNoSidewaysScroll(page)
      await page.locator('form.rename').getByRole('button', { name: 'Avbryt' }).tap()
      await expect(field).toHaveCount(0)
    } finally {
      await removeProject(page, id)
    }
  })
})

test.describe('@mobile catalog and assistant in the bottom sheet', () => {
  test('a tap on a piece in the catalog puts it in the plan', async ({ page }) => {
    const id = await createProject(page, projectName('katalog'))
    try {
      await sheet(page).getByRole('button', { name: 'Møbler', exact: true }).tap()
      await expect(sheet(page)).toHaveClass(/\bhalf\b/)
      // A finger is told to tap, not to drag
      await expect(sheet(page).getByText('Trykk på et møbel for å legge det i et passende rom.')).toBeVisible()
      // The sheet scrolls, and the list inside it does not scroll on its own as well
      const list = sheet(page).locator('.catalog-list')
      await expect(list).toHaveCSS('max-height', 'none')

      await sheet(page).getByPlaceholder('Søk…').fill('sofa, 3')
      await list.locator('li').filter({ hasText: 'Sofa, 3-seter' }).tap()
      // The sheet goes down so the new piece shows in the plan, selected
      await expect(sheet(page)).toHaveClass(/\bclosed\b/)
      await expect
        .poll(
          async () =>
            ((await (await page.request.get(`/api/projects/${id}`)).json()) as StoredFurniture).scenarios[0]!.furniture
              .length,
        )
        .toBe(1)
    } finally {
      await removeProject(page, id)
    }
  })

  test('the assistant takes the whole sheet when its field is tapped, with the field in view', async ({ page }) => {
    const id = await createProject(page, projectName('assistent'))
    try {
      await sheet(page).getByRole('button', { name: '✨ Assistent' }).tap()
      await expect(sheet(page)).toHaveClass(/\bhalf\b/)
      const input = sheet(page).locator('.assistant-input textarea')
      await expect(input).toBeVisible()

      await input.tap()
      await expect(input).toBeFocused()
      await expect(sheet(page)).toHaveClass(/\bfull\b/)
      // Let the sheet finish rising (a 0.2 s transition) before measuring
      let last = ''
      await expect(async () => {
        const now = JSON.stringify(await input.boundingBox())
        const settled = now === last
        last = now
        expect(settled).toBe(true)
      }).toPass()

      // The field and its button inside the window and above the toolbar, nothing over them
      const field = (await input.boundingBox())!
      const toolbar = (await page.locator('.toolbar').boundingBox())!
      expect(field.y).toBeGreaterThanOrEqual(0)
      expect(field.y + field.height).toBeLessThanOrEqual(toolbar.y + 1)
      await expectOnTop(input)
      const send = sheet(page).locator('.assistant-input button')
      await expect(send).toBeVisible()
      await expectOnTop(send)
      // The messages scroll inside the panel, so the field stays put under them
      await expect(sheet(page).locator('.assistant-messages')).toHaveCSS('overflow-y', 'auto')
      await expectNoSidewaysScroll(page)
    } finally {
      await removeProject(page, id)
    }
  })
})

interface StoredFurniture {
  scenarios: { furniture: unknown[] }[]
}

test.describe('@mobile error toast on a phone', () => {
  // The refused save is the point of the test, not a failure.
  test.use({ requestGuard: { allow: [(r) => r.status === 400 && r.method === 'PUT'] } })

  test('a failed save shows its toast under the top bar, clear of the sheet and the toolbar', async ({ page }) => {
    const id = await createProject(page, projectName('toast'))
    try {
      let refusals = 1
      await page.route(`**/api/projects/${id}`, async (route) => {
        if (route.request().method() === 'PUT' && refusals-- > 0)
          await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Feil' }) })
        else await route.fallback()
      })
      await page.locator('.project-name').fill(`${projectName('toast')} 2`)

      const toast = page.locator('.toast')
      await expect(toast).toBeVisible({ timeout: 10_000 })
      // The save state says so in words, on a line of its own, and the page does not get wider
      await expect(page.locator('.topbar .save-state.error')).toBeVisible()
      await expectNoSidewaysScroll(page)

      const box = (await toast.boundingBox())!
      const top = (await page.locator('.topbar').boundingBox())!
      const toolbar = (await page.locator('.toolbar').boundingBox())!
      const closedSheet = (await sheet(page).boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(top.y + top.height)
      expect(box.y + box.height).toBeLessThanOrEqual(closedSheet.y)
      expect(box.y + box.height).toBeLessThanOrEqual(toolbar.y)
      await expectWithinWidth(page, toast)
      await expectOnTop(toast)

      // A tap dismisses it; the next save goes through
      await toast.tap()
      await expect(toast).toHaveCount(0)
      await page.locator('.topbar .save-state.error').tap()
      await expect(page.getByText('Lagret', { exact: true })).toBeAttached({ timeout: 10_000 })
    } finally {
      await removeProject(page, id)
    }
  })
})

test.describe('@mobile print page on a phone', () => {
  test('the print page lays its sheets out one after the other, as wide as the phone', async ({ page }) => {
    const id = await createProject(page, projectName('utskrift'))
    try {
      await page.goto(`/#/p/${id}/print`)
      const printSheet = page.locator('.print-sheet').first()
      await expect(printSheet).toBeVisible()
      // Not the editor's bottom sheet: in the flow of the page, not stuck to the bottom of the screen
      await expect(printSheet).toHaveCSS('position', 'static')
      await expectWithinWidth(page, printSheet)
      await expectNoSidewaysScroll(page)
    } finally {
      await removeProject(page, id)
    }
  })
})
