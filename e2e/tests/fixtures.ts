import { deflateSync } from 'node:zlib'

import { expect, mergeTests, type Page } from '@playwright/test'
import { coverageTest, guardsTest } from '@wshno/playwright-config'

// Specs import test from here, not from @playwright/test. guardsTest (see @wshno/playwright-config) fails
// any test in which the page breaks its Content-Security-Policy, logs a console error or warning, throws
// uncaught, or gets a 4xx/5xx or network error for a request. coverageTest records the page's V8 coverage
// for monocart-reporter when the CI config has it (playwright.config.ts).
export { expect }
export const test = mergeTests(guardsTest, coverageTest).extend({
  // The 3D view: three.js deprecation notices from @react-three/fiber, and the GPU driver's performance
  // notes in headless Chromium. Neither is the app misbehaving.
  consoleGuard: {
    allow: [
      (e) => e.type === 'warning' && /^THREE\.\w+: .*(deprecated|has been removed)/.test(e.text),
      (e) => e.type === 'warning' && e.text.includes('GL Driver Message'),
    ],
  },
  // The project list asks for a thumbnail per project. The specs share one user and run side by side, so
  // a project another spec has just deleted can still be in the list this page fetched.
  requestGuard: {
    allow: [
      (r) => r.status === 404 && r.resourceType === 'image' && /\/api\/projects\/[\w-]+\/thumbnail\?/.test(r.url),
    ],
  },
})

/**
 * A project name with what the NAXSI edge in front of wsh.no has rejected before (æøå, parentheses,
 * an apostrophe), so a deployed env fails loudly if those requests are blocked again. Unique per
 * run, since a deployed env may keep projects from earlier runs.
 */
export const projectName = (what: string) => `E2E ${what} – Kjøkken (Ås's) ${Date.now().toString(36)}`

/** A synthetic floor plan: a light PNG with dark "walls", so no real plan ends up in the repo. */
export function planPng(width = 800, height = 600): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale
  const wall = (x: number, y: number) =>
    x < 12 || y < 12 || x >= width - 12 || y >= height - 12 || (Math.abs(x - width / 2) < 6 && y < height * 0.6)
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = wall(x, y) ? 40 : 245
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Creates a project from the project list and returns its id (the editor's URL). */
export async function createProject(page: Page, name: string): Promise<string> {
  await page.goto('/')
  await page.getByPlaceholder('Min leilighet').fill(name)
  await page.getByRole('button', { name: 'Opprett prosjekt' }).click()
  await page.waitForURL(/#\/p\/p_[\w-]+/)
  await expect(page.locator('.project-name')).toHaveValue(name)
  return page.url().split('#/p/')[1]!
}

/** Waits until autosave has stored the latest change. */
export async function saved(page: Page) {
  await expect(page.getByText('Lagret', { exact: true })).toBeVisible({ timeout: 10_000 })
}

/**
 * Removes a project the spec made (deployed envs keep their data between runs).
 *
 * If the editor still has a change to save (autosave waits for a quiet moment, then sends a PUT),
 * that save is let through first: deleting under it makes the PUT answer 404, which the request guard
 * rightly counts as a failed request. A test that ends right after an edit would otherwise fail now
 * and then, depending on whether the save got there before the delete.
 */
export async function removeProject(page: Page, id: string) {
  if (!page.isClosed()) {
    // Not an assertion: this runs in `finally`, where a throw would hide why the test failed. If the
    // save never finishes, the delete still runs and the guard reports the PUT it breaks.
    await expect(page.getByText('Lagrer…', { exact: true }))
      .toHaveCount(0, { timeout: 10_000 })
      .catch(() => {})
  }
  const res = await page.request.delete(`/api/projects/${id}`)
  expect([204, 404]).toContain(res.status())
}
