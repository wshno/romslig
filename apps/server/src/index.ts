import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { authOptionsFromEnv } from './auth.ts'
import { aiConfigFromEnv } from './ai/config.ts'
import { openStore } from './storage/index.ts'

const authOpts = authOptionsFromEnv()
const ai = aiConfigFromEnv()
const store = await openStore(authOpts)
const app = createApp(store, authOpts, { ai })
console.log(
  `Auth: ${authOpts.mode}${authOpts.allowedGroup ? ', gruppe ' + authOpts.allowedGroup : ''} · lagring: ${process.env.PG_HOST ? 'postgres' : 'filer'} · AI: ${ai.mode}${ai.mode === 'server' && ai.group ? ', gruppe ' + ai.group : ''}`,
)

const port = Number(process.env.PORT ?? 8787)
const server = serve({ fetch: app.fetch, port }, () => console.log(`API: http://localhost:${port}/api`))

// tsx watch restarts the process on every change. On Windows the previous process can hold the
// port for a moment, so retry instead of crashing, and release the port promptly on shutdown.
let retries = 0
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE' || retries++ >= 20) throw err
  setTimeout(() => server.listen(port), 250)
})
// Keep-alive connections (e.g. from the Vite dev proxy) would keep the port busy, so close them
// explicitly and never wait more than a second.
const shutdown = () => {
  setTimeout(() => process.exit(0), 1000).unref()
  server.close(() => {
    void Promise.resolve(store.close?.()).finally(() => process.exit(0))
  })
  if ('closeAllConnections' in server) server.closeAllConnections()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
