import { createProject, expect, projectName, removeProject, saved, test } from './fixtures'

const ceiling = /Takhøyde/

test.describe('autosave', () => {
  test('a change made right before leaving the editor is saved', async ({ page }) => {
    const name = projectName('utgang')
    const id = await createProject(page, name)
    try {
      await page.getByRole('spinbutton', { name: ceiling }).fill('2.9')
      // Straight out, without waiting for "Lagret": the save must not be dropped
      await page.getByTitle('Alle prosjekter').click()
      await page.getByRole('link', { name }).click()
      await expect(page.getByRole('spinbutton', { name: ceiling })).toHaveValue('2.9')

      // And the copy the editor opened with is the saved one: the next change is no conflict
      await page.getByRole('spinbutton', { name: ceiling }).fill('3')
      await saved(page)
      const stored = await (await page.request.get(`/api/projects/${id}`)).json()
      expect(stored.ceilingHeight).toBe(3)
    } finally {
      await removeProject(page, id)
    }
  })

  test.describe('when the server is unavailable', () => {
    // The 503s are the point of the test, not a failure.
    test.use({ requestGuard: { allow: [(r) => r.status === 503 && r.method === 'PUT'] } })

    test('the editor says so, tries again and gets the change through', async ({ page }) => {
      const id = await createProject(page, projectName('nytt forsøk'))
      try {
        let failures = 2
        await page.route(`**/api/projects/${id}`, async (route) => {
          if (route.request().method() === 'PUT' && failures-- > 0)
            await route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>503 Service Unavailable</h1>' })
          else await route.fallback()
        })
        await page.getByRole('spinbutton', { name: ceiling }).fill('2.8')
        await expect(page.getByRole('button', { name: 'Ikke lagret, prøver igjen' })).toBeVisible()
        await saved(page)
        const stored = await (await page.request.get(`/api/projects/${id}`)).json()
        expect(stored.ceilingHeight).toBe(2.8)
      } finally {
        await removeProject(page, id)
      }
    })
  })
})
