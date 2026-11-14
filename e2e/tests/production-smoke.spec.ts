import type { Page } from '@playwright/test'

import { expect, projectName, removeProject, saved, test } from './fixtures'

// Run only by production-smoke.yml (E2E_SUITE=production-smoke, see playwright.config.ts), against
// https://romslig.wsh.no as the shared e2e user: the whole chain NAXSI → Authelia → Traefik → API →
// PostgreSQL, which the nightly preview (file store) does not have. It works on real production data,
// so it touches only the one project it creates, and always deletes it again.
test('@production-smoke a project round-trips through production and is removed again', async ({ page }) => {
  // /api/health/ready also pings the store, i.e. PostgreSQL.
  expect((await page.request.get('/api/health')).status()).toBe(200)
  expect((await page.request.get('/api/health/ready')).status()).toBe(200)

  const shell = await page.goto('/')
  const headers = shell?.headers() ?? {}
  expect(headers['content-security-policy']).toContain("script-src 'self'")
  expect(headers['content-security-policy-report-only']).toBeUndefined()

  // The name has æøå, parentheses and an apostrophe, which the NAXSI edge has blocked before.
  const name = projectName('prod-smoke')
  const ceiling = page.getByRole('spinbutton', { name: /Takhøyde/ })
  let id: string | undefined
  try {
    await page.getByPlaceholder('Min leilighet').fill(name)
    await page.getByRole('button', { name: 'Opprett prosjekt' }).click()
    await page.waitForURL(/#\/p\/p_[\w-]+/)
    id = page.url().split('#/p/')[1]!
    await expect(page.locator('.project-name')).toHaveValue(name)

    await ceiling.fill('2.7')
    await saved(page)

    await page.reload()
    await expect(page.locator('.project-name')).toHaveValue(name)
    await expect(ceiling).toHaveValue('2.7')
    const stored = (await (await page.request.get(`/api/projects/${id}`)).json()) as {
      name: string
      ceilingHeight: number
    }
    expect(stored.name).toBe(name)
    expect(stored.ceilingHeight).toBeCloseTo(2.7)
  } finally {
    await cleanUp(page, name, id)
  }
})

/** Deletes the project this run made, and only that one. */
async function cleanUp(page: Page, name: string, id: string | undefined) {
  if (!id) {
    // Possibly created, but the editor never opened: look it up by its name, which is unique to this run.
    const res = await page.request.get('/api/projects')
    const list = res.ok() ? ((await res.json()) as { id: string; name: string }[]) : []
    id = list.find((p) => p.name === name)?.id
  }
  if (id) await removeProject(page.request, id)
}
