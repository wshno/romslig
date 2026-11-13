import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Source maps next to the bundle, so the e2e run's browser coverage maps back to src/ (and the
  // workspace packages). The repo is public, so they disclose nothing new.
  build: { sourcemap: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
})
