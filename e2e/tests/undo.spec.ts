import { createProject, expect, projectName, removeProject, saved, test } from './fixtures'

test.describe('undo', () => {
  test('takes back a typed name in one step, and does not count switching variant', async ({ page }) => {
    const name = projectName('angre')
    const id = await createProject(page, name)
    try {
      const undo = page.getByTitle('Angre (Ctrl+Z)')
      const redo = page.getByTitle('Gjør om (Ctrl+Y)')
      const field = page.locator('.project-name')
      await expect(undo).toBeDisabled()
      await expect(redo).toBeDisabled()

      // Typed key by key, as a person does: every key changes the project
      await field.click()
      await field.press('End')
      await page.keyboard.type(' med hems')
      await expect(field).toHaveValue(`${name} med hems`)

      await undo.click()
      await expect(field).toHaveValue(name)
      await expect(undo).toBeDisabled()
      await redo.click()
      await expect(field).toHaveValue(`${name} med hems`)

      // A new variant is a step. Looking at the other variant afterwards is not: undo takes the new one away.
      page.once('dialog', (d) => void d.accept('Forslag'))
      await page.getByTitle('Ny variant (kopi av denne)').click()
      const variant = page.locator('.scenario select')
      await expect(variant.locator('option')).toHaveCount(2)
      await variant.selectOption({ label: 'Eksisterende' })
      await undo.click()
      await expect(variant.locator('option')).toHaveCount(1)
      await expect(field).toHaveValue(`${name} med hems`)
      await saved(page)
    } finally {
      await removeProject(page, id)
    }
  })
})
