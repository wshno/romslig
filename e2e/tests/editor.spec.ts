import type { Page } from '@playwright/test'

import { createProject, expect, projectName, removeProject, saved, test } from './fixtures'

interface SavedProject {
  calibration: { calibrated: boolean }
  scenarios: {
    name: string
    walls: { a: { x: number; y: number }; b: { x: number; y: number } }[]
    rooms: unknown[]
    furniture: unknown[]
  }[]
}

/** The project as the API has it, so a check does not pass on what only the browser knows. */
async function stored(page: Page, id: string): Promise<SavedProject> {
  const res = await page.request.get(`/api/projects/${id}`)
  expect(res.status()).toBe(200)
  return (await res.json()) as SavedProject
}

/**
 * Clicks in the 2D drawing, given in screen pixels from its middle. The drawing has no plan image
 * here, so where a pixel lands in metres depends on the window: the test calibrates instead of
 * assuming a scale.
 */
async function drawing(page: Page) {
  const stage = page.locator('.plan2d .konvajs-content')
  await expect(stage).toBeVisible()
  // The drawing is refitted when the pane changes size: wait until it has settled
  let last = ''
  await expect(async () => {
    const now = JSON.stringify(await stage.boundingBox())
    const settled = now === last
    last = now
    expect(settled).toBe(true)
  }).toPass()
  const box = (await stage.boundingBox())!
  return (dx: number, dy: number) => page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy)
}

/** A drawing tool in the left toolbar. Its button also carries an icon, so the label is matched on its own. */
const tool = (page: Page, label: string) =>
  page.locator('.toolbar button').filter({ has: page.getByText(label, { exact: true }) })

/** Clicks a piece of furniture in the catalog and checks that it ended up in the active variant. */
async function furnish(page: Page, search: string, name: string) {
  await page.getByRole('button', { name: 'Møbler', exact: true }).click()
  await page.getByPlaceholder('Søk…').fill(search)
  await page.locator('.catalog-list li').filter({ hasText: name }).click()
  // The new piece is selected, and the panel shows it: placed in the room, with nothing in its way
  const panel = page.locator('.inspector')
  await expect(panel.getByText(name, { exact: true })).toBeVisible()
  await expect(panel.getByText('Ingen problemer')).toBeVisible()
  await panel
    .getByRole('button', { name: /Oversikt/ })
    .first()
    .click()
  await expect(page.locator('.room-list li').filter({ hasText: name })).toHaveCount(1)
}

// The way through the editor a new user takes: walls, rooms, scale, furniture, a variant, and the
// two side by side. Each step builds on the one before, so it is one test.
test.describe('editor', () => {
  test('draw a room, set the scale, furnish it, and compare it with a variant', async ({ page }) => {
    const id = await createProject(page, projectName('tegning'))
    try {
      await page.getByRole('button', { name: '2D', exact: true }).click()
      const click = await drawing(page)

      // Four walls, 300 × 200 px, closed by clicking the first corner again
      await tool(page, 'Vegg').click()
      await click(-150, -100)
      await click(150, -100)
      await click(150, 100)
      await click(-150, 100)
      await click(-150, -100)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Finn rom automatisk' }).click()
      await expect(page.getByText('Fant 1 rom.')).toBeVisible()
      const room = page.locator('.room-list li')
      await expect(room).toHaveCount(1)

      // The top wall is 6 m in reality. The answer is typed the Norwegian way, with a comma.
      await tool(page, 'Kalibrer').click()
      page.once('dialog', (d) => void d.accept('6,0'))
      await click(-150, -100)
      await click(150, -100)
      // 6 × 4 m between the centre lines of the walls, a little less inside them
      await expect(room).toContainText(/2[23],\d m²/)
      await saved(page)
      await expect
        .poll(async () => {
          const p = await stored(page, id)
          const top = p.scenarios[0]!.walls[0]
          return p.calibration.calibrated && top ? Math.abs(top.b.x - top.a.x) : 0
        })
        .toBeCloseTo(6, 3)

      await furnish(page, 'sofa, 3', 'Sofa, 3-seter')

      // A variant is a copy: the sofa comes along, the dining table is only in the variant
      page.once('dialog', (d) => void d.accept('Med spisebord (ny)'))
      await page.getByTitle('Ny variant (kopi av denne)').click()
      const variant = page.locator('.scenario select')
      await expect(variant.locator('option:checked')).toHaveText('Med spisebord (ny)')
      await furnish(page, 'spisebord, 4', 'Spisebord, 4 pers.')
      await saved(page)

      await page.getByRole('button', { name: 'Sammenlign', exact: true }).click()
      await expect(page.getByText('Etter: Med spisebord (ny)')).toBeVisible()
      await expect(page.getByText(/^Før: /)).toBeVisible()
      await expect(page.locator('.compare-summary')).toContainText('Lagt til: Spisebord, 4 pers.')
      await expect(page.locator('.compare-summary')).not.toContainText('Sofa')

      // All of it is stored, not just on screen
      await expect
        .poll(async () =>
          (await stored(page, id)).scenarios.map((s) => [s.walls.length, s.rooms.length, s.furniture.length]),
        )
        .toEqual([
          [4, 1, 1],
          [4, 1, 2],
        ])
      await page.reload()
      await expect(variant.locator('option:checked')).toHaveText('Med spisebord (ny)')
      await page.getByRole('button', { name: 'Møbler', exact: true }).click()
      await expect(page.locator('.room-list li')).toHaveCount(2)
    } finally {
      await removeProject(page.request, id)
    }
  })
})
