import { createProject, expect, projectName, removeProject, test } from './fixtures'

// docker-compose.e2e.yml's auth proxy signs in as e2e-user on :5173 and as e2e-other on :5174, the way
// Authelia would for two different people. A deployed env has one test user, hence @local-only.
const OTHER = process.env.OTHER_USER_URL ?? 'http://localhost:5174'

test('@local-only one user cannot see or open another user\x27s project', async ({ page, playwright }) => {
  const name = projectName('privat')
  const id = await createProject(page, name)
  try {
    const other = await playwright.request.newContext({ baseURL: OTHER })
    const list = (await (await other.get('/api/projects')).json()) as { id: string }[]
    expect(list.map((p) => p.id)).not.toContain(id)
    expect((await other.get(`/api/projects/${id}`)).status()).toBe(404)
    expect((await other.get(`/api/projects/${id}/plan`)).status()).toBe(404)
    expect((await other.delete(`/api/projects/${id}`)).status()).toBe(204) // a no-op for someone else
    await other.dispose()

    await page.reload()
    await expect(page.locator('.project-name')).toHaveValue(name)
  } finally {
    await removeProject(page, id)
  }
})
