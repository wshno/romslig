import type { CDPSession, Page } from '@playwright/test'

import { createProject, expect, projectName, removeProject, test } from './fixtures'

// Fingers on the 2D plan: tapping, dragging and pinching (M3), and the on-screen stand-ins for the
// keyboard (M4: the DrawBar). Tagged @mobile: only the `mobile` project (an emulated Pixel 7 with a
// touch screen, playwright.config.ts) runs these.
//
// A tap is page.touchscreen.tap. A drag or a pinch is sent as raw touch events over CDP
// (Input.dispatchTouchEvent), which Chromium turns into touch and pointer events as a real screen
// does. Where something lands in the plan is worked out from the stage's own transform (window.Konva,
// which the konva package sets), so the tests do not assume a scale. What happened is read from the
// project as the API stored it, and from the inspector in the bottom sheet.

type Vec2 = { x: number; y: number }

interface StoredProject {
  scenarios: {
    walls: { id: string; a: Vec2; b: Vec2 }[]
    openings: { wallId: string }[]
    rooms: unknown[]
    furniture: { id: string; catalogId: string; x: number; y: number }[]
  }[]
}

/** The active (only) variant as the API has it, so a check does not pass on what only the browser knows. */
async function stored(page: Page, id: string) {
  const res = await page.request.get(`/api/projects/${id}`)
  expect(res.status()).toBe(200)
  return ((await res.json()) as StoredProject).scenarios[0]!
}

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const length = (w: { a: Vec2; b: Vec2 }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)

/**
 * The plan as it is drawn now: where a point in metres is on the screen and back. Waits until the
 * stage has stopped changing size first: it is refitted when the toolbar grows a row of options or
 * loses it.
 */
async function plan(page: Page) {
  const stage = page.locator('.plan2d .konvajs-content')
  await expect(stage).toBeVisible()
  let last = ''
  await expect(async () => {
    const now = JSON.stringify(await stage.boundingBox())
    const settled = now === last
    last = now
    expect(settled).toBe(true)
  }).toPass()
  const box = (await stage.boundingBox())!
  const view = await planView(page)
  return {
    box,
    view,
    /** A point given in screen pixels from the middle of the plan. */
    at: (dx: number, dy: number): Vec2 => ({ x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy }),
    screen: (w: Vec2): Vec2 => ({ x: box.x + view.x + w.x * view.scale, y: box.y + view.y + w.y * view.scale }),
    world: (p: Vec2): Vec2 => ({ x: (p.x - box.x - view.x) / view.scale, y: (p.y - box.y - view.y) / view.scale }),
  }
}

/** The stage's pan and zoom (screen px per metre). */
function planView(page: Page): Promise<{ scale: number; x: number; y: number }> {
  return page.evaluate(() => {
    const konva = (window as unknown as { Konva: { stages: { scaleX(): number; x(): number; y(): number }[] } }).Konva
    const stage = konva.stages[0]!
    return { scale: stage.scaleX(), x: stage.x(), y: stage.y() }
  })
}

const tap = (page: Page, p: Vec2) => page.touchscreen.tap(p.x, p.y)

/** Raw touch events: each finger keeps its id from the moment it touches until all are lifted. */
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: Vec2[]) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: fingers.map((p, id) => ({ x: Math.round(p.x), y: Math.round(p.y), id })),
  })
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** One finger pressed at `from`, moved to `to` in steps, and lifted there. */
async function fingerDrag(cdp: CDPSession, from: Vec2, to: Vec2, steps = 10) {
  await touch(cdp, 'touchStart', [from])
  for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', [lerp(from, to, i / steps)])
  await touch(cdp, 'touchEnd', [])
}

/** Two fingers around `centre`, `from` px apart, spread (or pinched) to `to` px apart, then lifted. */
async function pinch(cdp: CDPSession, centre: Vec2, from: number, to: number, steps = 10) {
  const fingers = (d: number): Vec2[] => [
    { x: centre.x - d / 2, y: centre.y },
    { x: centre.x + d / 2, y: centre.y },
  ]
  // The first finger, then the second, as a hand does
  await touch(cdp, 'touchStart', fingers(from).slice(0, 1))
  await touch(cdp, 'touchStart', fingers(from))
  for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', fingers(from + ((to - from) * i) / steps))
  await touch(cdp, 'touchEnd', [])
}

/** A tool in the bottom toolbar. Its button also carries an icon, so the label is matched on its own. */
const tool = (page: Page, label: string) =>
  page.locator('.toolbar button').filter({ has: page.getByText(label, { exact: true }) })
const drawBar = (page: Page) => page.getByRole('toolbar', { name: 'Tegning' })
const sheet = (page: Page) => page.getByRole('region', { name: 'Egenskaper' })

/** Draws one wall with two taps (`from` and `to` in px from the plan's middle) and «Ferdig». */
async function tapWall(page: Page, id: string, from: [number, number], to: [number, number], before = 0) {
  await tool(page, 'Vegg').tap()
  const p = await plan(page)
  await tap(page, p.at(...from))
  await tap(page, p.at(...to))
  await drawBar(page).getByRole('button', { name: 'Ferdig' }).tap()
  await expect.poll(async () => (await stored(page, id)).walls.length).toBe(before + 1)
  return (await stored(page, id)).walls.at(-1)!
}

/**
 * Adds a piece from the catalog in the bottom sheet. With no rooms or walls it goes to the same
 * spot every time; it is selected, and the sheet goes down so the plan shows.
 */
async function furnish(page: Page, id: string, search: string, name: string) {
  await sheet(page).getByRole('button', { name: 'Møbler', exact: true }).tap()
  await page.getByPlaceholder('Søk…').fill(search)
  const before = (await stored(page, id)).furniture.length
  await page.locator('.catalog-list li').filter({ hasText: name }).tap()
  await expect(sheet(page)).toHaveClass(/\bclosed\b/)
  await expect.poll(async () => (await stored(page, id)).furniture.length).toBe(before + 1)
  return (await stored(page, id)).furniture.at(-1)!
}

test.describe('@mobile fingers on the plan', () => {
  test.beforeEach(async ({ page }) => {
    // The behaviour under test follows the pointer, not the width: the emulated phone must report a finger
    await page.goto('/')
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  })

  test('a tap selects a wall', async ({ page }) => {
    const id = await createProject(page, projectName('trykk-vegg'))
    try {
      const wall = await tapWall(page, id, [-100, 0], [100, 0])
      expect(length(wall)).toBeGreaterThan(1)

      await tool(page, 'Velg').tap()
      const p = await plan(page)
      await tap(page, p.screen(mid(wall.a, wall.b)))
      // Selected: the sheet comes up with the wall's properties
      await expect(sheet(page)).toHaveClass(/\bhalf\b/)
      await expect(page.getByRole('spinbutton', { name: 'Lengde' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Del vegg' })).toBeVisible()
    } finally {
      await removeProject(page, id)
    }
  })

  test('draws a closed room with the wall tool by taps, and the room is found', async ({ page }) => {
    const id = await createProject(page, projectName('trykk-rom'))
    try {
      await tool(page, 'Vegg').tap()
      const p = await plan(page)
      // Four corners and the first one again; each tap well away from the one before (two taps on
      // the same spot end the chain, as a double-click does)
      for (const [dx, dy] of [
        [-120, -80],
        [120, -80],
        [120, 80],
        [-120, 80],
        [-120, -80],
      ] as const)
        await tap(page, p.at(dx, dy))
      await drawBar(page).getByRole('button', { name: 'Ferdig' }).tap()
      await expect.poll(async () => (await stored(page, id)).walls.length).toBe(4)
      // Closed: the last wall ends where the first one starts
      const walls = (await stored(page, id)).walls
      expect(walls[3]!.b.x).toBeCloseTo(walls[0]!.a.x, 6)
      expect(walls[3]!.b.y).toBeCloseTo(walls[0]!.a.y, 6)

      await tool(page, 'Velg').tap()
      await sheet(page).getByRole('button', { name: 'Oversikt', exact: true }).tap()
      await page.getByRole('button', { name: 'Finn rom automatisk' }).tap()
      await expect(page.getByText('Fant 1 rom.')).toBeVisible()
      await expect(page.locator('.room-list li')).toHaveCount(1)
    } finally {
      await removeProject(page, id)
    }
  })

  test('the door tool puts a door in the wall that is tapped', async ({ page }) => {
    const id = await createProject(page, projectName('trykk-dor'))
    try {
      const wall = await tapWall(page, id, [-120, 0], [120, 0])
      await tool(page, 'Dør').tap()
      const p = await plan(page)
      await tap(page, p.screen(mid(wall.a, wall.b)))
      await expect.poll(async () => (await stored(page, id)).openings.map((o) => o.wallId)).toEqual([wall.id])
    } finally {
      await removeProject(page, id)
    }
  })

  test('one finger drags a piece of furniture', async ({ page }) => {
    const id = await createProject(page, projectName('dra-mobel'))
    try {
      const sofa = await furnish(page, id, 'sofa, 3', 'Sofa, 3-seter')
      const p = await plan(page)
      const cdp = await page.context().newCDPSession(page)
      const from = p.screen(sofa)
      await fingerDrag(cdp, from, { x: from.x + 120, y: from.y - 80 })
      // Moved about as far as the finger went (no walls to snap to), and the plan did not pan
      await expect
        .poll(async () => (await stored(page, id)).furniture[0]!.x)
        .toBeGreaterThan(sofa.x + 60 / p.view.scale)
      const moved = (await stored(page, id)).furniture[0]!
      expect(moved.x - sofa.x).toBeCloseTo(120 / p.view.scale, 0)
      expect(moved.y - sofa.y).toBeCloseTo(-80 / p.view.scale, 0)
      expect(await planView(page)).toEqual(p.view)
    } finally {
      await removeProject(page, id)
    }
  })

  test('a pinch zooms the plan, and neither selects nor places anything', async ({ page }) => {
    const id = await createProject(page, projectName('knip'))
    try {
      const wall = await tapWall(page, id, [-120, 0], [120, 0])
      const cdp = await page.context().newCDPSession(page)

      // With Velg, right over the wall: the plan zooms in, and the wall is not selected
      await tool(page, 'Velg').tap()
      let p = await plan(page)
      await pinch(cdp, p.screen(mid(wall.a, wall.b)), 60, 180)
      await expect.poll(async () => (await planView(page)).scale).toBeGreaterThan(p.view.scale * 1.5)
      await expect(page.getByRole('spinbutton', { name: 'Lengde' })).toHaveCount(0)

      // With the wall tool: zooms back out, and no wall is started (no «Ferdig» to end one)
      await tool(page, 'Vegg').tap()
      p = await plan(page)
      await pinch(cdp, p.at(0, 60), 200, 80)
      await expect.poll(async () => (await planView(page)).scale).toBeLessThan(p.view.scale / 1.5)
      await expect(drawBar(page).getByRole('button', { name: 'Fri vinkel' })).toBeVisible()
      await expect(drawBar(page).getByRole('button', { name: 'Ferdig' })).toHaveCount(0)
      expect((await stored(page, id)).walls).toHaveLength(1)
    } finally {
      await removeProject(page, id)
    }
  })

  test('in a drawing tool the point goes where the finger is lifted, not where it touched', async ({ page }) => {
    const id = await createProject(page, projectName('slipp'))
    try {
      await tool(page, 'Vegg').tap()
      const p = await plan(page)
      const cdp = await page.context().newCDPSession(page)
      const touched = p.at(-140, -40)
      const lifted = p.at(60, -40)
      await fingerDrag(cdp, touched, lifted)
      // The aim followed the finger without panning the plan, and the start point is set: «Ferdig» shows
      await expect(drawBar(page).getByRole('button', { name: 'Ferdig' })).toBeVisible()
      expect(await planView(page)).toEqual(p.view)
      await tap(page, p.at(60, 100))
      await drawBar(page).getByRole('button', { name: 'Ferdig' }).tap()

      await expect.poll(async () => (await stored(page, id)).walls.length).toBe(1)
      const [wall] = (await stored(page, id)).walls
      const at = p.world(lifted)
      // Within the 10 cm grid (and the snap) of where it was lifted, metres away from where it touched
      expect(Math.hypot(wall!.a.x - at.x, wall!.a.y - at.y)).toBeLessThan(0.15)
      expect(Math.abs(wall!.a.x - p.world(touched).x)).toBeGreaterThan(1)
    } finally {
      await removeProject(page, id)
    }
  })

  test('the length field draws a wall of the length typed in it', async ({ page }) => {
    const id = await createProject(page, projectName('lengdefelt'))
    try {
      await tool(page, 'Vegg').tap()
      const p = await plan(page)
      await tap(page, p.at(-120, 0))
      // The start point is set: the bar has the length field, with a number keyboard
      const field = drawBar(page).getByRole('textbox', { name: 'Lengde (m)' })
      await expect(field).toHaveAttribute('inputmode', 'decimal')
      await field.fill('3,2')
      await drawBar(page).getByRole('button', { name: 'Sett' }).tap()
      await expect(field).toHaveValue('')
      await drawBar(page).getByRole('button', { name: 'Ferdig' }).tap()

      await expect.poll(async () => (await stored(page, id)).walls.length).toBe(1)
      const [wall] = (await stored(page, id)).walls
      expect(length(wall!)).toBeCloseTo(3.2, 6)

      // And the inspector says so
      await tool(page, 'Velg').tap()
      const q = await plan(page)
      await tap(page, q.screen(mid(wall!.a, wall!.b)))
      await expect(page.getByRole('spinbutton', { name: 'Lengde' })).toHaveValue('3.2')
    } finally {
      await removeProject(page, id)
    }
  })

  test('«Velg flere» selects two pieces of furniture with taps', async ({ page }) => {
    const id = await createProject(page, projectName('velg-flere'))
    try {
      // Two pieces apart: the first one is dragged off the spot the catalog puts every piece on
      const sofa = await furnish(page, id, 'sofa, 3', 'Sofa, 3-seter')
      let p = await plan(page)
      const cdp = await page.context().newCDPSession(page)
      const from = p.screen(sofa)
      await fingerDrag(cdp, from, { x: from.x + 120, y: from.y - 80 })
      await expect.poll(async () => (await stored(page, id)).furniture[0]!.x).toBeGreaterThan(sofa.x + 1)
      const table = await furnish(page, id, 'spisebord, 4', 'Spisebord, 4 pers.')
      const movedSofa = (await stored(page, id)).furniture[0]!

      // Nothing selected (a tap on empty space), then «Velg flere» and a tap on each
      p = await plan(page)
      // Near the top right of the plan: clear of both pieces, and of the sheet once a selection has
      // brought it up over the lower half
      const empty = p.at(p.box.width / 2 - 40, 150 - p.box.height / 2)
      await tap(page, empty)
      await expect(page.locator('.inspector-header h3')).toHaveCount(0)
      const many = drawBar(page).getByRole('button', { name: 'Velg flere' })
      await many.tap()
      await expect(many).toHaveAttribute('aria-pressed', 'true')
      await tap(page, p.screen(movedSofa))
      await tap(page, p.screen(table))
      const summary = page.locator('.inspector .selection-summary')
      await expect(summary).toHaveText('2 valgt: 2 møbler')

      // A tap on empty space keeps both; another tap on one takes it out again
      await tap(page, empty)
      await expect(summary).toHaveText('2 valgt: 2 møbler')
      await tap(page, p.screen(table))
      await expect(summary).toHaveCount(0)
      await expect(page.locator('.inspector-header h3')).toHaveText('Møbel')
    } finally {
      await removeProject(page, id)
    }
  })
})
