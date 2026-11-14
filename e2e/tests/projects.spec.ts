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

  test('a project gets a thumbnail in the list, and is renamed and copied from there', async ({ page }) => {
    const name = projectName('liste')
    const ids = [await createProject(page, name)]
    try {
      await page.goto('/')
      const row = (text: string) => page.getByRole('listitem').filter({ hasText: text })
      await row(name).scrollIntoViewIfNeeded()
      const thumbnail = row(name).locator('.thumb img')
      await expect(thumbnail).toHaveJSProperty('complete', true)
      expect(await thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

      // The new name goes to the API as JSON, with the characters the edge has stopped before
      const renamed = `${name} (omdøpt)`
      await row(name).getByRole('button', { name: 'Gi nytt navn' }).click()
      await page.getByRole('textbox', { name: 'Nytt navn' }).fill(renamed)
      await page.getByRole('textbox', { name: 'Nytt navn' }).press('Enter')
      await expect(page.getByRole('link', { name: renamed, exact: true })).toBeVisible()

      await row(renamed).getByRole('button', { name: 'Kopier' }).click()
      await page.getByRole('link', { name: `${renamed} (kopi)`, exact: true }).click()
      await expect(page.locator('.project-name')).toHaveValue(`${renamed} (kopi)`)
      ids.push(page.url().split('#/p/')[1]!)
      expect(new Set(ids).size).toBe(2)
    } finally {
      for (const id of ids) await removeProject(page.request, id)
    }
  })

  test('a project is exported to a file, and imported from it as a project of its own', async ({ page }, testInfo) => {
    const name = projectName('eksport')
    const ids = [await createProject(page, name)]
    try {
      await page
        .locator('.file-button input[type=file]')
        .setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: planPng() })
      await expect(page.getByRole('button', { name: /Digitaliser med AI/ })).toBeVisible()
      await saved(page)
      await page.getByRole('spinbutton', { name: /Takhøyde/ }).fill('2.65')
      await saved(page)

      await page.goto('/')
      const rows = page.getByRole('listitem').filter({ hasText: name })
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        rows.getByRole('button', { name: 'Eksporter' }).click(),
      ])
      expect(download.suggestedFilename()).toMatch(/^romslig-e2e-eksport-kjøkken-ås-s-\w+-\d{4}-\d\d-\d\d\.json$/)
      const file = testInfo.outputPath('eksport.json')
      await download.saveAs(file)

      // The file goes up as a form upload, the way a floor plan does
      await page.getByLabel('Fil å importere').setInputFiles(file)
      await expect(rows).toHaveCount(2)
      const listed = (await (await page.request.get('/api/projects')).json()) as { id: string; name: string }[]
      ids.push(...listed.filter((p) => p.name === name && p.id !== ids[0]).map((p) => p.id))
      expect(ids).toHaveLength(2)

      const [original, imported] = await Promise.all(
        ids.map(async (id) => ({
          project: (await (await page.request.get(`/api/projects/${id}`)).json()) as Record<string, unknown>,
          plan: await (await page.request.get(`/api/projects/${id}/plan`)).body(),
        })),
      )
      expect(imported!.project.ceilingHeight).toBe(2.65)
      expect(imported!.project.scenarios).toEqual(original!.project.scenarios)
      expect(imported!.project.planImage).toMatchObject({ width: 800, height: 600 })
      expect(imported!.plan.equals(original!.plan)).toBe(true)

      // The newest is listed first: open it, and it has its plan
      await rows.first().getByRole('link', { name, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`#/p/${ids[1]}$`))
      await expect(page.locator('.project-name')).toHaveValue(name)
      await expect(page.getByRole('button', { name: /Digitaliser med AI/ })).toBeVisible()
    } finally {
      for (const id of ids) await removeProject(page.request, id)
    }
  })

  test('the plan image can be hidden in 2D, and stays hidden after a reload', async ({ page }) => {
    const id = await createProject(page, projectName('skjul plan'))
    try {
      await page
        .locator('.file-button input[type=file]')
        .setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: planPng() })
      await expect(page.getByRole('button', { name: /Digitaliser med AI/ })).toBeVisible()
      await saved(page)

      // The canvas can't be inspected: the toggle and the opacity slider tell whether the plan is drawn
      const overlay = page.locator('.plan2d-overlay')
      const toggle = overlay.getByRole('button', { name: 'Plantegning', exact: true })
      const slider = overlay.getByRole('slider')
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect(slider).toBeVisible()

      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(slider).toHaveCount(0)

      await page.reload()
      await expect(page.getByRole('button', { name: /Digitaliser med AI/ })).toBeVisible()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(slider).toHaveCount(0)

      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect(slider).toBeVisible()
    } finally {
      await removeProject(page.request, id)
    }
  })
})
