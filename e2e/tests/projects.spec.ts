import { createProject, expect, planPng, projectName, removeProject, saved, test } from './fixtures'

test.describe('projects', () => {
  test('a project with a Norwegian name gets a plan later, and keeps changes after a reload', async ({ page }) => {
    const name = projectName('plan')
    const id = await createProject(page, name)
    try {
      // Created without a plan: the digitize step offers the upload
      await expect(page.getByText('Prosjektet har ingen plantegning ennå.')).toBeVisible()
      await page
        .locator('.file-button input[type=file]')
        .setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: planPng() })
      await expect(page.getByRole('button', { name: /Digitaliser med AI/ })).toBeVisible()
      await saved(page)

      // An ordinary edit goes through autosave (PUT with the whole project, Norwegian name and all)
      await page.getByRole('spinbutton', { name: /Takhøyde/ }).fill('2.65')
      await saved(page)

      await page.reload()
      await expect(page.locator('.project-name')).toHaveValue(name)
      await expect(page.getByRole('button', { name: /Digitaliser med AI/ })).toBeVisible()
      await expect(page.getByRole('spinbutton', { name: /Takhøyde/ })).toHaveValue('2.65')

      const plan = await page.request.get(`/api/projects/${id}/plan`)
      expect(plan.headers()['content-type']).toBe('image/png')
    } finally {
      await removeProject(page.request, id)
    }
  })

  test('a project uploaded with its plan opens with it, and can be deleted from the list', async ({ page }) => {
    const name = projectName('slett')
    await page.goto('/')
    await page.getByPlaceholder('Min leilighet').fill(name)
    await page.getByLabel('Plantegning (JPG/PNG)').setInputFiles({
      name: 'plan.png',
      mimeType: 'image/png',
      buffer: planPng(),
    })
    await page.getByRole('button', { name: 'Opprett prosjekt' }).click()
    await expect(page.getByRole('button', { name: /Digitaliser med AI/ })).toBeVisible()

    await page.goto('/')
    const row = page.getByRole('listitem').filter({ hasText: name })
    page.once('dialog', (d) => void d.accept())
    await row.getByRole('button', { name: 'Slett' }).click()
    await expect(row).toHaveCount(0)
  })
})
