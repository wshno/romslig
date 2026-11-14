import { createProject, expect, projectName, removeProject, test } from './fixtures'

// The promise in the key dialog: in byok mode the user's Anthropic key goes from the browser straight
// to api.anthropic.com, and never to Romslig's own server. Anthropic is stubbed, so no real key or
// network call is needed.
const KEY = 'sk-ant-e2e-0000-not-a-real-key'

test('the Anthropic key only goes to Anthropic, never to /api', async ({ page }) => {
  const toAnthropic: string[] = []
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  }
  await page.route('https://api.anthropic.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    // The SDK sends the key as x-api-key or as a bearer token, depending on version
    const h = await route.request().allHeaders()
    toAnthropic.push(h['x-api-key'] ?? h.authorization?.replace(/^Bearer /, '') ?? '')
    await route.fulfill({
      headers: cors,
      json: { data: [{ type: 'model', id: 'claude-opus-5-5' }], has_more: false, first_id: null, last_id: null },
    })
  })
  // Every request to our own API, all headers and the body, checked at the end
  const ownRequests: Promise<string>[] = []
  page.on('request', (req) => {
    if (!req.url().includes('/api/')) return
    ownRequests.push(
      req.allHeaders().then((h) => {
        const text = JSON.stringify(h) + (req.postData() ?? '')
        return text.includes('sk-ant-') ? `${req.method()} ${req.url()}` : ''
      }),
    )
  })

  const id = await createProject(page, projectName('nøkkel'))
  try {
    await page.getByRole('button', { name: /Nøkkel/ }).click()
    await page.getByLabel('Anthropic API-nøkkel').fill(KEY)
    await page.getByRole('button', { name: 'Lagre og test' }).click()
    await expect(page.getByText('✓ Nøkkelen fungerer.')).toBeVisible()
    await page.getByRole('button', { name: 'Ferdig' }).click()

    // Kept for this tab only
    expect(await page.evaluate(() => sessionStorage.getItem('romslig.anthropicKey'))).toBe(KEY)
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(KEY)

    // Make the editor save, then reload: the project and every /api call stay free of the key
    await page.getByRole('spinbutton', { name: /Takhøyde/ }).fill('2.5')
    await expect(page.getByText('Lagret', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: /Nøkkel ✓/ })).toBeVisible()

    const project = await (await page.request.get(`/api/projects/${id}`)).text()
    expect(project).not.toContain(KEY)
    expect(toAnthropic).toContain(KEY)
    expect(ownRequests.length).toBeGreaterThan(3)
    expect((await Promise.all(ownRequests)).filter(Boolean)).toEqual([])
  } finally {
    await removeProject(page, id)
  }
})
