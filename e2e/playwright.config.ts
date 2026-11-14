/**
 * Drives an already-running Romslig: the api and web images behind the forward-auth stand-in from
 * docker-compose.e2e.yml (http://localhost:5173, signed in as e2e-user), or a deployed env such as
 * a PR preview or the nightly preview (BASE_URL), signed in through Authelia by auth.setup.ts.
 */
import { devices } from '@playwright/test'
import { ciReporters, definePlaywrightConfig, isCI, localReporters, monocartReporter } from '@wshno/playwright-config'

import { authFile } from './tests/auth-paths'

const remote = Boolean(process.env.BASE_URL)
const baseURL = process.env.BASE_URL ?? 'http://localhost:5173'

// E2E_SUITE=production-smoke (production-smoke.yml) runs only the specs tagged @production-smoke, and
// every other run leaves them out: they work on production data and belong to that job alone. Set per
// project, not at the top level, so the remote run's setup project (the Authelia login) still runs.
const productionSmoke = process.env.E2E_SUITE === 'production-smoke'
const suite = productionSmoke
  ? { grep: /@production-smoke/ }
  : // Specs that need the compose stack itself (e.g. a second user through the second proxy port).
    { grepInvert: remote ? [/@local-only/, /@production-smoke/] : /@production-smoke/ }

// Shared defaults (testDir ./tests, forbidOnly, retries, the github/html/json CI reporters at the
// paths the reusable reads, trace, screenshot and video on failure) come from @wshno/playwright-config.
export default definePlaywrightConfig({
  // In CI, also monocart-reporter with the browser's V8 coverage of the web bundle (recorded by
  // coverageTest in tests/fixtures.ts): monocart-coverage/ (v8 html, lcov, Cobertura), which
  // pr-e2e.yml uploads and the quality artifact counts.
  reporter: isCI
    ? [
        ...ciReporters,
        monocartReporter({
          name: 'Romslig E2E',
          coverage: {
            origin: baseURL,
            // The bundle holds apps/web/src and the workspace packages it imports; both become
            // repo-relative paths, the same as the unit tests' Cobertura. The same files are left out as
            // in the unit coverage (vitest.config.ts), except App.tsx and viewer3d/, which only this
            // suite covers.
            layout: {
              root: ['apps/web', 'packages/*'],
              sourceDirs: ['src'],
              exclude: /^apps\/web\/src\/(main\.tsx|vite-env\.d\.ts|theme\.ts|zod-config\.ts)$/,
            },
          },
        }),
      ]
    : localReporters,
  use: {
    baseURL,
    // Also for the first attempt: a test that fails once and passes on retry is the one we need to see.
    trace: 'retain-on-failure',
    // A UTF-8 locale for the browser, wherever the suite runs. Without one Chromium cannot write a
    // file name with æøå in it and calls every such download "download". e2e/Dockerfile sets it for
    // the compose stack, but the nightly runs in the shared playwright-config runner image.
    launchOptions: {
      env: { ...process.env, LANG: /utf-?8/i.test(process.env.LANG ?? '') ? process.env.LANG : 'C.UTF-8' },
    },
  },
  projects: remote
    ? [
        { name: 'setup', testMatch: /auth\.setup\.ts/ },
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'], storageState: authFile },
          dependencies: ['setup'],
          ...suite,
        },
      ]
    : [{ name: 'chromium', testIgnore: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] }, ...suite }],
})
