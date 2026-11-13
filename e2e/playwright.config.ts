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

// The web bundle holds apps/web/src and the workspace packages it imports (packages/*/src). Vite's
// source maps name them relative to dist/assets, which monocart resolves against the page's origin
// (`localhost-5173/src/...`, `localhost-5173/packages/shared/src/...`). Both become repo-relative
// paths, the same as the unit tests' Cobertura, so the quality artifact can merge the two.
const PACKAGE_SOURCE = /(?:^|\/)(packages\/[^/]+\/src\/.*)$/
const WEB_SOURCE = /(?:^|\/)(?:apps\/web\/)?(src\/.*)$/
function repoPath(sourcePath: string): string {
  const path = sourcePath.replaceAll('\\', '/')
  const pkg = PACKAGE_SOURCE.exec(path)
  if (pkg?.[1]) return pkg[1]
  const web = WEB_SOURCE.exec(path)
  return web?.[1] ? `apps/web/${web[1]}` : path
}

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
            sourcePath: repoPath,
            sourceFilter: (sourcePath: string) =>
              !sourcePath.includes('node_modules/') && /(?:^|\/)(?:packages\/[^/]+\/)?src\//.test(sourcePath),
          },
        }),
      ]
    : localReporters,
  use: {
    baseURL,
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
