import type { Page, Route } from '@playwright/test'

import { expect, planPng, projectName, removeProject, test } from './fixtures'

// Photographing a room on the phone (the main reason for the phone layout): the photo flow in the
// bottom sheet, the photos surviving a reload (Android may drop the tab while the camera is open),
// and recognition all the way to the furniture in the plan. Anthropic is stubbed, as in byok.spec.ts,
// so no real key or network call is needed. Tagged @mobile: only the `mobile` project (an emulated
// Pixel 7) runs it.

const KEY = 'sk-ant-e2e-0000-not-a-real-key'

interface Seeded {
  id: string
  version: number
  scenarios: Record<string, unknown>[]
}

/** A project with one 4 × 3 m room, «Stue», saved the way the editor saves. */
async function seedProject(page: Page, what: string): Promise<Seeded> {
  const created = await page.request.post('/api/projects', { multipart: { name: projectName(what) } })
  expect(created.status()).toBe(201)
  const project = (await created.json()) as Seeded
  const wall = (id: string, ax: number, ay: number, bx: number, by: number) => ({
    id,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: 0.2,
    height: 2.4,
    loadBearing: 'no',
    exterior: true,
  })
  const scenario = {
    ...project.scenarios[0],
    walls: [
      wall('t', -0.1, -0.1, 4.1, -0.1),
      wall('r', 4.1, -0.1, 4.1, 3.1),
      wall('b', 4.1, 3.1, -0.1, 3.1),
      wall('l', -0.1, 3.1, -0.1, -0.1),
    ],
    rooms: [
      {
        id: 'r1',
        name: 'Stue',
        type: 'stue',
        polygon: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
          { x: 0, y: 3 },
        ],
        statedArea: null,
      },
    ],
  }
  const stored = await page.request.put(`/api/projects/${project.id}`, {
    headers: { 'If-Match': String(project.version) },
    data: { ...project, scenarios: [scenario] },
  })
  expect(stored.status()).toBe(200)
  return project
}

const sheet = (page: Page) => page.getByRole('region', { name: 'Egenskaper' })
const photos = (page: Page) => page.getByRole('img', { name: /^Bilde \d$/ })
const recognize = (page: Page) => page.getByRole('button', { name: '✨ Gjenkjenn møbler' })

/** A photo from the camera: a small synthetic PNG (the app downscales it to JPEG itself). */
const cameraPhoto = (n: number) => ({ name: `stue-${n}.png`, mimeType: 'image/png', buffer: planPng(320, 240) })

/** Opens the editor, and the photo panel for «Stue» from the button in Oversikt. */
async function openPanel(page: Page, id: string) {
  await page.goto(`/#/p/${id}`)
  await expect(page.locator('.plan2d')).toBeVisible()
  await expect(sheet(page)).toHaveClass(/\bclosed\b/)
  await sheet(page).locator('.sheet-handle').tap()
  await expect(sheet(page)).toHaveClass(/\bhalf\b/)

  const entry = page.getByRole('button', { name: '📷 Ta bilde av et rom' })
  await entry.tap()
  const rooms = page.getByRole('list', { name: 'Velg rom' })
  await expect(rooms).toBeVisible()
  await expect(sheet(page)).toHaveClass(/\bfull\b/)
  // Avbryt puts the sheet back where it was
  await page.getByRole('button', { name: 'Avbryt' }).tap()
  await expect(sheet(page)).toHaveClass(/\bhalf\b/)

  await entry.tap()
  await rooms.getByRole('button', { name: /Stue/ }).tap()
  await expect(page.getByText(/Bruk 1–4 bilder av «Stue»/)).toBeVisible()
  await expect(sheet(page)).toHaveClass(/\bfull\b/)
}

/** The SSE body Anthropic streams for a message with one text block. */
function sseText(text: string): string {
  const events: [string, unknown][] = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_e2e',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

/** What Claude «sees»: a sofa against the top wall and a plant by the left one. */
const RECOGNIZED = {
  items: [
    {
      catalog_id: 'sofa-3',
      name: 'Grå sofa',
      width_cm: 210,
      depth_cm: 90,
      height_cm: 85,
      side: 'top',
      position_hint: 'midt på veggen',
      confidence: 'high',
      photo: 1,
      match: 'good',
      proposal: null,
    },
    {
      catalog_id: 'plante',
      name: 'Plante',
      width_cm: 40,
      depth_cm: 40,
      height_cm: 120,
      side: 'left',
      position_hint: 'i hjørnet',
      confidence: 'medium',
      photo: 1,
      match: 'good',
      proposal: null,
    },
  ],
  notes: '',
}

/**
 * Answers Claude's calls: straight to api.anthropic.com in byok mode (the key test lists models,
 * recognition streams a message), or through our proxy in server mode.
 */
async function stubAnthropic(page: Page) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  }
  const answer = async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (new URL(req.url()).pathname.endsWith('/v1/models'))
      return route.fulfill({
        headers: cors,
        json: { data: [{ type: 'model', id: 'claude-opus-5-5' }], has_more: false, first_id: null, last_id: null },
      })
    return route.fulfill({
      headers: { ...cors, 'content-type': 'text/event-stream' },
      body: sseText(JSON.stringify(RECOGNIZED)),
    })
  }
  await page.route('https://api.anthropic.com/**', answer)
  await page.route(/\/api\/ai\/v1\//, answer)
}

test.describe('@mobile photo of a room', () => {
  test('photos are taken one by one in a full-height sheet, and come back after a reload', async ({ page }) => {
    const project = await seedProject(page, 'mobilbilde')
    try {
      await openPanel(page, project.id)
      await expect(recognize(page)).toBeDisabled()
      await expect(page.getByRole('button', { name: '📷 Ta bilde', exact: true })).toBeVisible()

      // Two photos from the camera, one at a time: each is added, none replaces the other
      const camera = page.getByTestId('photo-camera')
      await camera.setInputFiles(cameraPhoto(1))
      await expect(photos(page)).toHaveCount(1)
      await camera.setInputFiles(cameraPhoto(2))
      await expect(photos(page)).toHaveCount(2)
      await expect(recognize(page)).toBeEnabled()
      // The buttons stay in reach at the bottom of the sheet, however long the list gets
      await expect(recognize(page)).toBeInViewport()
      await expect(sheet(page)).toHaveClass(/\bfull\b/)

      await page.getByRole('button', { name: 'Fjern bilde 1' }).tap()
      await expect(photos(page)).toHaveCount(1)

      // The wall the photo faces: a tap on the top edge of the small plan of the room (4 × 3 m in a
      // 150 × 110 drawing: the top edge runs at y = 14)
      const picker = page.locator('.photo-list li').first().getByRole('group', { name: 'Velg veggen du ser mot' })
      await picker.evaluate((el) => el.scrollIntoView({ block: 'center' }))
      const box = (await picker.boundingBox())!
      await picker.tap({ position: { x: box.width / 2, y: (14 * box.width) / 150 } })
      await expect(page.getByText('Ser mot veggen øverst')).toBeVisible()
      await expect(recognize(page)).toBeEnabled()

      // The tab is reloaded (as Android may do on return from the camera): the panel is back, with
      // its photo and direction, and the sheet opens to show it
      await page.reload()
      await expect(page.getByText(/Bruk 1–4 bilder av «Stue»/)).toBeVisible()
      await expect(sheet(page)).toHaveClass(/\bfull\b/)
      await expect(photos(page)).toHaveCount(1)
      await expect(page.getByText('Ser mot veggen øverst')).toBeVisible()
      await expect(recognize(page)).toBeEnabled()
    } finally {
      await removeProject(page, project.id)
    }
  })

  test('the key dialog fits the phone, and the panel keeps its photos while the key goes in', async ({ page }) => {
    // The e2e envs run in byok mode, as byok.spec.ts assumes
    await stubAnthropic(page)
    const project = await seedProject(page, 'mobilnøkkel')
    try {
      await openPanel(page, project.id)
      await page.getByTestId('photo-camera').setInputFiles(cameraPhoto(1))
      await expect(photos(page)).toHaveCount(1)
      await recognize(page).tap()

      // No key in this tab yet: the key dialog, inside the screen and above the sheet
      const dialog = page.getByRole('dialog', { name: /Anthropic-nøkkel/ })
      await expect(dialog).toBeVisible()
      const box = (await dialog.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
      await dialog.getByLabel('Anthropic API-nøkkel').fill(KEY)
      await dialog.getByRole('button', { name: 'Lagre og test' }).tap()
      await expect(dialog.getByText('✓ Nøkkelen fungerer.')).toBeVisible()
      await dialog.getByRole('button', { name: 'Ferdig' }).tap()
      await expect(dialog).toBeHidden()

      // The panel waited with its photo, and the same button goes on
      await expect(sheet(page)).toHaveClass(/\bfull\b/)
      await expect(photos(page)).toHaveCount(1)
      await recognize(page).tap()
      await expect(page.getByRole('button', { name: 'Legg inn 2 møbler' })).toBeVisible()
    } finally {
      await removeProject(page, project.id)
    }
  })

  test('recognised furniture is added to the plan, and the sheet gets out of the way', async ({ page }) => {
    await stubAnthropic(page)
    // In byok mode a key for this tab, so recognition goes straight on (the test above covers the
    // dialog); server mode ignores it
    await page.addInitScript((key) => sessionStorage.setItem('romslig.anthropicKey', key), KEY)
    const project = await seedProject(page, 'mobilgjenkjenning')
    try {
      await openPanel(page, project.id)
      await page.getByTestId('photo-camera').setInputFiles(cameraPhoto(1))
      await expect(photos(page)).toHaveCount(1)
      await recognize(page).tap()

      await expect(page.getByRole('checkbox', { name: /Grå sofa/ })).toBeChecked()
      await expect(page.getByRole('checkbox', { name: /Plante/ })).toBeChecked()
      await page.getByRole('button', { name: 'Legg inn 2 møbler' }).tap()

      // The sheet goes down so the plan shows the new pieces, and stays down although they are selected
      await expect(sheet(page)).toHaveClass(/\bclosed\b/)
      await expect(sheet(page).locator('.sheet-handle')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('.recognize')).toHaveCount(0)
      await expect(page.locator('.plan2d')).toBeVisible()
      await expect
        .poll(
          async () => {
            const stored = (await (await page.request.get(`/api/projects/${project.id}`)).json()) as {
              scenarios: { furniture: { label: string | null }[] }[]
            }
            return stored.scenarios[0]!.furniture.map((f) => f.label).sort()
          },
          { timeout: 15_000 },
        )
        .toEqual(['Grå sofa', 'Plante'])
      await expect(sheet(page)).toHaveClass(/\bclosed\b/)
    } finally {
      await removeProject(page, project.id)
    }
  })
})
