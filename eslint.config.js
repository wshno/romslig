import { base, ignores, node, react, vitest } from '@wshno/eslint-config'

// @wshno/eslint-config: JS/TS and SonarJS recommended, @eslint-react and React Refresh for the web app,
// Node globals for the server and tooling, and the Vitest preset for unit tests.
// Not the default export (React Router framework mode): apps/web is a plain Vite SPA.
/** @type {import('eslint').Linter.Config[]} */
export default [
  ...ignores,
  ...base,
  ...react.map((c) => ({ ...c, files: (c.files ?? ['**/*.{js,jsx,ts,tsx}']).map((f) => `apps/web/${f}`) })),
  ...node.map((c) => ({ ...c, files: ['apps/server/**/*.ts', 'packages/**/*.ts', '*.{js,ts}', '**/vite.config.ts'] })),
  ...vitest(),
  // e2e/ is its own package with its own eslint config.
  { ignores: ['data/**', '.playwright-mcp/**', 'e2e/**'] },
]
