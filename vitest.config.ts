import { defineConfig } from 'vitest/config'

// Root config for `npm run coverage:ci` (CI): runs every workspace's tests in one Vitest run and
// writes the reports the reusable pr-build workflow reads from coverage/. `npm test` still runs
// each workspace on its own.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/server', 'apps/web'],
    reporters: ['default', 'junit', 'json'],
    outputFile: {
      junit: './coverage/junit-report.xml',
      json: './coverage/json-report.json',
    },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/server/src/**'],
      reporter: ['cobertura', 'lcov', 'html', 'json', 'text-summary'],
    },
  },
})
