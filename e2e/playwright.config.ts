/**
 * Drives an already-running Romslig: the api and web images behind the forward-auth stand-in from
 * docker-compose.e2e.yml (http://localhost:5173, signed in as e2e-user), or a deployed env such as
 * a PR preview or the nightly preview (BASE_URL), signed in through Authelia by auth.setup.ts.
 */
import { devices } from '@playwright/test'
import { definePlaywrightConfig } from '@wshno/playwright-config'

import { authFile } from './tests/auth-paths'

const remote = Boolean(process.env.BASE_URL)

// Shared defaults (testDir ./tests, forbidOnly, retries, the github/html/json CI reporters at the
// paths the reusable reads, trace, screenshot and video on failure) come from @wshno/playwright-config.
export default definePlaywrightConfig({
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    // Also for the first attempt: a test that fails once and passes on retry is the one we need to see.
    trace: 'retain-on-failure',
  },
  // Specs that need the compose stack itself (e.g. a second user through the second proxy port).
  grepInvert: remote ? /@local-only/ : undefined,
  projects: remote
    ? [
        { name: 'setup', testMatch: /auth\.setup\.ts/ },
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'], storageState: authFile },
          dependencies: ['setup'],
        },
      ]
    : [{ name: 'chromium', testIgnore: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } }],
})
