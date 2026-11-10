import { createProject, expect, projectName, removeProject, saved, test } from './fixtures'

test.describe('number fields', () => {
  test('keep what is typed while the value has a lower limit', async ({ page }) => {
    const id = await createProject(page, projectName('tallfelt'))
    try {
      // The ceiling height is never stored below 1.8 m, so the first key ("1") is stored as 1.8
      const field = page.locator('label.field', { hasText: 'Takhøyde' }).locator('input')
      await field.click()
      await field.press('ControlOrMeta+A')
      await page.keyboard.type('1.9')
      await expect(field).toHaveValue('1.9')

      // Below the limit the field shows what was typed until it is left, and then what was stored
      await field.press('ControlOrMeta+A')
      await page.keyboard.type('1')
      await expect(field).toHaveValue('1')
      await field.press('Tab')
      await expect(field).toHaveValue('1.8')

      await saved(page)
      await page.reload()
      await expect(field).toHaveValue('1.8')
    } finally {
      await removeProject(page.request, id)
    }
  })
})
