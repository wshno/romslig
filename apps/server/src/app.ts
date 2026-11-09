import { Hono } from 'hono'
import { Project, emptyScenario, newId } from '@romslig/shared'
import { auth, type AuthOptions, type User } from './auth.ts'
import { HttpError } from './errors.ts'
import { MAX_PLAN_BYTES, readPngSize } from './png.ts'
import type { ProjectStore } from './storage/index.ts'
import { aiConfigFromEnv, aiModeFor, type AiConfig } from './ai/config.ts'
import { aiProxy } from './ai/proxy.ts'

type Env = { Variables: { user: User } }

export interface AppOptions {
  ai?: AiConfig
  /** Used by the AI proxy to reach Anthropic (tests inject a fake). */
  fetch?: typeof fetch
}

/**
 * The HTTP API. Everything except /health requires a user (see auth.ts). The AI features run in
 * the browser; the API only tells it which mode to use and, in server mode, proxies its calls.
 */
export function createApp(store: ProjectStore, authOpts: AuthOptions, opts: AppOptions = {}) {
  const ai = opts.ai ?? aiConfigFromEnv({})
  const app = new Hono<Env>().basePath('/api')

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: err.message || 'Ukjent feil' }, 500)
  })

  // Unauthenticated: used by Kubernetes probes
  app.get('/health', (c) => c.json({ ok: true }))

  app.use('*', auth(authOpts))
  const owner = (c: { get(key: 'user'): User }) => c.get('user').id

  app.get('/me', (c) => c.json(c.get('user')))

  /** What the browser needs to start: the user's AI mode (never the key) and who they are. */
  app.get('/config', (c) => {
    const user = c.get('user')
    return c.json({ aiMode: aiModeFor(ai, user), user })
  })

  app.route('/ai', aiProxy(ai, opts.fetch))

  app.get('/projects', async (c) => c.json(await store.list(owner(c))))

  app.post('/projects', async (c) => {
    const body = await c.req.parseBody()
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'Min leilighet'
    const now = new Date().toISOString()
    const scenario = emptyScenario()
    const project: Project = {
      id: newId('p_'),
      name,
      planImage: null,
      calibration: { pxPerMeter: 100, calibrated: false },
      ceilingHeight: 2.4,
      northAngle: 0,
      scenarios: [scenario],
      activeScenarioId: scenario.id,
      chat: [],
      customFurniture: [],
      version: 0,
      createdAt: now,
      updatedAt: now,
    }
    let png: Uint8Array | null = null
    const image = body.image
    if (image instanceof File) {
      if (image.size > MAX_PLAN_BYTES) throw new HttpError(413, 'Plantegningen er for stor (maks 15 MB).')
      png = new Uint8Array(await image.arrayBuffer())
      const { width, height } = readPngSize(png)
      project.planImage = { file: 'plan.png', width, height }
      // Default scale: assume the plan is ~15 m across until calibrated
      project.calibration.pxPerMeter = Math.max(width, height) / 15
    }
    return c.json(await store.create(owner(c), project, png), 201)
  })

  app.get('/projects/:id', async (c) => c.json(await store.get(owner(c), c.req.param('id'))))

  app.put('/projects/:id', async (c) => {
    const ifMatch = c.req.header('If-Match')
    if (!ifMatch) throw new HttpError(428, 'Mangler If-Match (prosjektversjon).')
    const expected = Number(ifMatch.replace(/"/g, ''))
    if (!Number.isInteger(expected) || expected < 0) throw new HttpError(400, 'Ugyldig If-Match.')
    const parsed = Project.safeParse(await c.req.json())
    if (!parsed.success) throw new HttpError(422, 'Ugyldig prosjektdata: ' + parsed.error.message)
    if (parsed.data.id !== c.req.param('id')) throw new HttpError(400, 'Id stemmer ikke')
    return c.json(await store.update(owner(c), parsed.data, expected))
  })

  app.delete('/projects/:id', async (c) => {
    await store.delete(owner(c), c.req.param('id'))
    return c.body(null, 204)
  })

  app.get('/projects/:id/plan', async (c) => {
    const png = await store.getPlan(owner(c), c.req.param('id'))
    return c.body(png as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-cache',
    })
  })

  return app
}
