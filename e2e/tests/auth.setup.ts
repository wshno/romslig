import { expect, test as setup } from '@playwright/test'
import * as OTPAuth from 'otpauth'

import { authFile } from './auth-paths'

// Deployed envs only (BASE_URL): Romslig has no login of its own. Traefik sends every request through
// Authelia's forward auth, so the first visit lands on auth.wsh.no; after password + TOTP Authelia
// sends the browser back, and its session cookie (on .wsh.no) is all the specs need.
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set to test a deployed env (E2E_USERNAME, E2E_PASSWORD, E2E_OTP_SECRET)`)
  return value
}

setup('sign in through Authelia', async ({ page }) => {
  const username = required('E2E_USERNAME')
  const password = required('E2E_PASSWORD')
  const otpSecret = required('E2E_OTP_SECRET')

  await page.goto('/')
  await page.waitForURL(/auth\.wsh\.no/, { timeout: 15_000 })
  await page.getByRole('textbox', { name: /username/i }).fill(username)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/auth\.wsh\.no\/2fa/, { timeout: 10_000 })

  // Generated just before typing, so a slow login can't leave a stale code. Authelia renders one
  // input per digit (#otp-input) that auto-advances and submits once all digits are in.
  const code = new OTPAuth.TOTP({ secret: otpSecret, digits: 6, period: 30 }).generate()
  const digits = page.locator('#otp-input').getByRole('textbox')
  await expect(digits).toHaveCount(code.length)
  await digits.first().click()
  await page.keyboard.type(code)

  await expect(page.getByRole('heading', { name: 'Romslig', level: 1 })).toBeVisible({ timeout: 20_000 })
  await page.context().storageState({ path: authFile })
})
