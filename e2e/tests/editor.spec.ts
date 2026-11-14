import type { Page } from '@playwright/test'

import { createProject, expect, projectName, removeProject, saved, test } from './fixtures'

interface SavedProject {
  version: number
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
  // The header's way back, not the Oversikt tab: that one shows the rooms, not the furniture tab
  await panel
    .locator('.inspector-header')
    .getByRole('button', { name: /Oversikt/ })
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

      // Four walls, 300 × 200 px, closed by clicking the first corner again. Alt keeps the corners
      // off the 10 cm grid, so the top wall is exactly as long as the calibration line below.
      await tool(page, 'Vegg').click()
      await page.keyboard.down('Alt')
      await click(-150, -100)
      await click(150, -100)
      await click(150, 100)
      await click(-150, 100)
      await click(-150, -100)
      await page.keyboard.up('Alt')
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

  test('types the length of a wall while drawing it, and changes it in the panel', async ({ page }) => {
    const id = await createProject(page, projectName('lengde'))
    try {
      await page.getByRole('button', { name: '2D', exact: true }).click()
      const click = await drawing(page)
      const stage = (await page.locator('.plan2d .konvajs-content').boundingBox())!
      const at = (dx: number, dy: number) =>
        page.mouse.move(stage.x + stage.width / 2 + dx, stage.y + stage.height / 2 + dy)
      const lengths = async () =>
        (await stored(page, id)).scenarios[0]!.walls.map((w) =>
          Math.round(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) * 100),
        )

      await tool(page, 'Vegg').click()
      await click(-150, 0)
      // Toward the right, typed with a comma; then down, typed with a point, corrected with Backspace
      await at(100, 4)
      await page.keyboard.type('3,5')
      await page.keyboard.press('Enter')
      await at(0, 150)
      await page.keyboard.type('2.259')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Enter')
      // The first Escape only drops what was typed, the second ends the wall
      await page.keyboard.type('7')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await saved(page)
      await expect.poll(lengths).toEqual([350, 225])

      // In the panel the length is stored when Enter is pressed, not on the way (no 1 m step for "12")
      await tool(page, 'Velg').click()
      await click(-140, 0)
      const length = page.getByRole('spinbutton', { name: 'Lengde' })
      await expect(length).toHaveValue('3.5')
      await length.fill('')
      await length.pressSequentially('12')
      await length.press('Enter')
      await saved(page)
      const walls = async () => (await stored(page, id)).scenarios[0]!.walls
      await expect.poll(lengths).toContain(1200)
      // The wall in the corner came along: it still starts where the first one ends
      const [first, second] = await walls()
      expect(second!.a.x).toBeCloseTo(first!.b.x, 6)
      expect(second!.a.y).toBeCloseTo(first!.b.y, 6)
    } finally {
      await removeProject(page.request, id)
    }
  })

  test('Escape clears the selection, and the inspector keeps its tabs while something is selected', async ({
    page,
  }) => {
    const id = await createProject(page, projectName('utvalg'))
    try {
      await page.getByRole('button', { name: '2D', exact: true }).click()
      const click = await drawing(page)
      const tabs = page.locator('.inspector .tabs')
      const wallPanel = page.getByRole('spinbutton', { name: 'Lengde' })

      // One wall, drawn with Alt (no grid snap) so it lies exactly where the clicks below select
      // it; Escape ends it and goes back to Velg
      await tool(page, 'Vegg').click()
      await page.keyboard.down('Alt')
      await click(-150, 0)
      await click(150, 0)
      await page.keyboard.up('Alt')
      await page.keyboard.press('Escape')
      await expect(tool(page, 'Velg')).toHaveClass(/active/)

      // Selected: the wall's properties, and the tabs still above them
      await click(0, 0)
      await expect(wallPanel).toBeVisible()
      await expect(tabs).toBeVisible()
      await expect(tabs.getByRole('button')).toHaveText(['Oversikt', 'Møbler', '✨ Assistent'])

      await page.keyboard.press('Escape')
      await expect(wallPanel).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Finn rom automatisk' })).toBeVisible()
      await expect(tool(page, 'Velg')).toHaveClass(/active/)

      // A tab clicked with something selected clears the selection and shows that tab
      await click(0, 0)
      await expect(wallPanel).toBeVisible()
      await tabs.getByRole('button', { name: 'Møbler', exact: true }).click()
      await expect(wallPanel).toHaveCount(0)
      await expect(page.getByPlaceholder('Søk…')).toBeVisible()
      await expect(tabs.getByRole('button', { name: 'Møbler', exact: true })).toHaveClass(/active/)
    } finally {
      await removeProject(page.request, id)
    }
  })

  test('snaps wall corners to the 10 cm grid, and Alt turns that off', async ({ page }) => {
    const id = await createProject(page, projectName('rutenett'))
    try {
      await page.getByRole('button', { name: '2D', exact: true }).click()
      const click = await drawing(page)
      const walls = async () => (await stored(page, id)).scenarios[0]!.walls
      const onGrid = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-6

      await tool(page, 'Vegg').click()
      await click(-123, -47)
      await click(131, -45)
      await page.keyboard.press('Escape')
      await saved(page)
      await expect.poll(async () => (await walls()).length).toBe(1)
      const [w] = await walls()
      expect([w!.a.x, w!.a.y, w!.b.x, w!.b.y].every(onGrid)).toBe(true)

      // With Alt held the corner lands where the pointer is, which is off the grid here. Escape
      // also left the wall tool, so pick it again.
      await tool(page, 'Vegg').click()
      await page.keyboard.down('Alt')
      await click(-117, 63)
      await click(-117, 151)
      await page.keyboard.up('Alt')
      await page.keyboard.press('Escape')
      await saved(page)
      await expect.poll(async () => (await walls()).length).toBe(2)
      const free = (await walls())[1]!
      expect([free.a.x, free.a.y, free.b.x, free.b.y].every(onGrid)).toBe(false)
    } finally {
      await removeProject(page.request, id)
    }
  })

  test('measures a distance without changing the project, and Escape clears the measurement', async ({ page }) => {
    const id = await createProject(page, projectName('måling'))
    try {
      await page.getByRole('button', { name: '2D', exact: true }).click()
      const click = await drawing(page)
      const readout = page.locator('.plan2d .measure-readout')

      // A wall to measure along; its corners snap to the grid like the measuring tool's points
      await tool(page, 'Vegg').click()
      await click(-150, 0)
      await click(150, 0)
      await page.keyboard.press('Escape')
      await saved(page)
      await expect.poll(async () => (await stored(page, id)).scenarios[0]!.walls.length).toBe(1)
      const before = await stored(page, id)
      const { a, b } = before.scenarios[0]!.walls[0]!
      const length = `${Math.hypot(b.x - a.x, b.y - a.y)
        .toFixed(2)
        .replace('.', ',')} m`

      // The same two clicks with the measuring tool land on the wall's ends
      await page.keyboard.press('m')
      await expect(tool(page, 'Måle')).toHaveClass(/active/)
      await click(-150, 0)
      await click(150, 0)
      await expect(readout).toHaveText(`Avstand: ${length}`)
      // The next click starts a new measurement, from where the pointer still is (nothing to show yet)
      await click(0, 0)
      await expect(readout).toHaveCount(0)
      await click(-150, 0)
      await click(150, 0)
      await expect(readout).toHaveText(`Avstand: ${length}`)

      // Escape clears it and goes back to Velg, as it ends a wall
      await page.keyboard.press('Escape')
      await expect(readout).toHaveCount(0)
      await expect(tool(page, 'Velg')).toHaveClass(/active/)

      // Measuring is not a change to the project: nothing was saved
      await expect(page.getByText('Lagret', { exact: true })).toBeVisible()
      expect((await stored(page, id)).version).toBe(before.version)
    } finally {
      await removeProject(page.request, id)
    }
  })

  test('drags a wall sideways with the wall in the corner following, and splits it', async ({ page }) => {
    const id = await createProject(page, projectName('flytt-vegg'))
    try {
      await page.getByRole('button', { name: '2D', exact: true }).click()
      const click = await drawing(page)
      const stage = (await page.locator('.plan2d .konvajs-content').boundingBox())!
      const to = (dx: number, dy: number) =>
        page.mouse.move(stage.x + stage.width / 2 + dx, stage.y + stage.height / 2 + dy, { steps: 8 })
      const walls = async () => (await stored(page, id)).scenarios[0]!.walls

      // An L: a wall to the right, then one down. Alt keeps the clicks exact, so the wall lies
      // under the pointer where it is grabbed below.
      await tool(page, 'Vegg').click()
      await page.keyboard.down('Alt')
      await click(-150, 0)
      await click(150, 0)
      await click(150, 150)
      await page.keyboard.up('Alt')
      await page.keyboard.press('Escape')
      await saved(page)
      await expect.poll(async () => (await walls()).length).toBe(2)
      const [top] = await walls()

      // Select the top wall and drag its middle part down
      await tool(page, 'Velg').click()
      await click(-50, 0)
      await expect(page.getByRole('button', { name: 'Del vegg' })).toBeVisible()
      await to(-50, 0)
      await page.mouse.down()
      await to(-50, 40)
      await to(-50, 70)
      await page.mouse.up()
      await saved(page)
      await expect.poll(async () => (await walls())[0]!.a.y).toBeGreaterThan(top!.a.y + 0.1)
      const [moved, side] = await walls()
      // Still horizontal, moved a whole number of 10 cm steps, and the corner is still closed
      expect(moved!.b.y).toBeCloseTo(moved!.a.y, 6)
      const steps = (moved!.a.y - top!.a.y) * 10
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6)
      expect(moved!.a.x).toBeCloseTo(top!.a.x, 6)
      expect(side!.a.x).toBeCloseTo(moved!.b.x, 6)
      expect(side!.a.y).toBeCloseTo(moved!.b.y, 6)

      // Split it in the middle: two pieces that meet there
      await page.getByRole('button', { name: 'Del vegg' }).click()
      await saved(page)
      await expect.poll(async () => (await walls()).length).toBe(3)
      const [first, second] = await walls()
      expect(first!.b.x).toBeCloseTo((moved!.a.x + moved!.b.x) / 2, 6)
      expect(second!.a.x).toBeCloseTo(first!.b.x, 6)
      expect(second!.b.x).toBeCloseTo(moved!.b.x, 6)
    } finally {
      await removeProject(page.request, id)
    }
  })

  test('focus hides the tools and the panel and shows 3D alone, until the panels are shown again', async ({ page }) => {
    const id = await createProject(page, projectName('fokus'))
    try {
      const views = page.locator('.views')
      const before = (await views.boundingBox())!.width
      await page.getByRole('button', { name: 'Fokus', exact: true }).click()
      await expect(page.locator('.toolbar')).toHaveCount(0)
      await expect(page.locator('.inspector')).toHaveCount(0)
      await expect(page.locator('.plan2d')).toHaveCount(0)
      await expect(page.locator('.viewer3d')).toBeVisible()
      await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveClass(/active/)
      await expect.poll(async () => (await views.boundingBox())!.width).toBeGreaterThan(before + 300)

      await page.getByRole('button', { name: 'Vis paneler' }).click()
      await expect(page.locator('.toolbar')).toBeVisible()
      await expect(page.locator('.inspector')).toBeVisible()
      await expect(page.getByRole('button', { name: '2D + 3D', exact: true })).toHaveClass(/active/)
    } finally {
      await removeProject(page.request, id)
    }
  })
})
