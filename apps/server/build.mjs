// Bundles the API (and @romslig/shared, which is TypeScript source) into one ESM file for the
// distroless runtime image, which has no node_modules.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  sourcemap: true,
  legalComments: 'none',
  // CommonJS dependencies call require(), which an ES module doesn't have.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
})
