import { createProject, expect, projectName, removeProject, saved, test } from './fixtures'

// Two tabs (or a phone and a PC) on the same project: the second save must not silently overwrite
// the first. The API answers 409 and the editor asks what to do.
test.describe('saving from two places', () => {
  // The 409 is the point of the test, not a failure.
  test.use({ requestGuard: { allow: [(r) => r.status === 409 && r.method === 'PUT'] } })

  test('the stale tab gets the conflict dialog instead of overwriting', async ({ page, context }) => {
    const id = await createProject(page, projectName('konflikt'))
    try {
      const other = await context.newPage()
      await other.goto(`/#/p/${id}`)
      await expect(other.getByRole('spinbutton', { name: /Takhøyde/ })).toBeVisible()

      await page.getByRole('spinbutton', { name: /Takhøyde/ }).fill('2.7')
      await saved(page)

      await other.getByRole('spinbutton', { name: /Takhøyde/ }).fill('3.1')
      await expect(other.getByText('Ikke lagret (konflikt)')).toBeVisible()
      await other.getByRole('button', { name: 'Last inn siste versjon' }).click()
      await expect(other.getByRole('spinbutton', { name: /Takhøyde/ })).toHaveValue('2.7')
    } finally {
      await removeProject(page.request, id)
    }
  })
})
