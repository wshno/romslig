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
      // Every source file counts, not only the ones a test imports (Vitest's default). Left out: tests,
      // the web app's bootstrapping and static config (the e2e coverage leaves these out too, see
      // e2e/playwright.config.ts), and App.tsx and viewer3d/ (three.js rendering, no unit tests): the e2e
      // suite measures those.
      include: ['packages/*/src/**', 'apps/server/src/**', 'apps/web/src/**'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'apps/web/src/main.tsx',
        'apps/web/src/theme.ts',
        'apps/web/src/zod-config.ts',
        'apps/web/src/App.tsx',
        'apps/web/src/viewer3d/**',
      ],
      reporter: ['cobertura', 'lcov', 'html', 'json', 'text-summary'],
    },
  },
})
