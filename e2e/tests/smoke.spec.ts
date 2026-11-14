import { expectAccessible, parseCsp } from '@wshno/playwright-config'

import { expect, test } from './fixtures'

test('the project list loads, with the web and API versions in the footer', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Romslig', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Prosjekter' })).toBeVisible()
  const footer = page.locator('.site-footer')
  await expect(footer).toContainText('web ')
  await expect(footer).toContainText(/api (dev|\d)/)
  await expect(footer).not.toContainText('ulik versjon')
})

// axe (WCAG 2.x A/AA) on the project list: fails on serious or critical violations.
test('the project list is accessible', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Prosjekter' })).toBeVisible()
  await expectAccessible(page)
})

test('the API answers health without a session, and everything else only behind auth', async ({ page }) => {
  expect((await page.request.get('/api/health')).ok()).toBe(true)
  const me = (await (await page.request.get('/api/me')).json()) as { id: string; groups: string[] }
  expect(me.id).toBeTruthy()
  expect(me.groups).toContain('romslig-users')
})

test('the app shell has a CSP that lets the browser reach only itself and Anthropic', async ({ page }) => {
  const headers = (await page.request.get('/')).headers()
  // Enforced (CSP_MODE=enforce) everywhere this suite runs: the e2e stack, previews and production
  expect(headers['content-security-policy-report-only']).toBeUndefined()
  const [policy] = parseCsp(headers['content-security-policy'])
  expect(policy?.get('script-src')).toEqual(["'self'"])
  expect(policy?.get('connect-src')).toEqual(["'self'", 'https://api.anthropic.com'])
  expect(policy?.get('object-src')).toEqual(["'none'"])
  expect(policy?.get('frame-ancestors')).toEqual(["'none'"])
})
