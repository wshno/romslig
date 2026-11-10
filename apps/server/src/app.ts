import { Hono } from 'hono'
import { Project, emptyScenario, newId, planThumbnailSvg } from '@romslig/shared'
import { auth, type AuthOptions, type User } from './auth.ts'
import { HttpError } from './errors.ts'
import { MAX_PLAN_BYTES, readPngSize } from './png.ts'
import type { ProjectStore } from './storage/index.ts'
import { aiConfigFromEnv, aiModeFor, type AiConfig } from './ai/config.ts'
import { aiProxy } from './ai/proxy.ts'

type Env = { Variables: { user: User } }

export interface BuildInfo {
  version: string | null
  sha: string | null
}

export const buildInfoFromEnv = (env: NodeJS.ProcessEnv = process.env): BuildInfo => ({
  version: env.APP_VERSION || null,
  sha: env.GIT_SHA || null,
})

async function readPlanUpload(image: File) {
  if (image.size > MAX_PLAN_BYTES) throw new HttpError(413, 'Plantegningen er for stor (maks 15 MB).')
  const png = new Uint8Array(await image.arrayBuffer())
  return { png, ...readPngSize(png) }
}

/** Default scale until calibrated: assume the plan is about 15 m across. */
const defaultPxPerMeter = (width: number, height: number) => Math.max(width, height) / 15

/** Longest project name we store. */
const MAX_NAME = 200

export interface AppOptions {
  ai?: AiConfig
  /** Version of this build (APP_VERSION / GIT_SHA from the image), shown in the web footer. */
  build?: BuildInfo
  /** Used by the AI proxy to reach Anthropic (tests inject a fake). */
  fetch?: typeof fetch
}

/**
 * The HTTP API. Everything except /health requires a user (see auth.ts). The AI features run in
 * the browser; the API only tells it which mode to use and, in server mode, proxies its calls.
 */
export function createApp(store: ProjectStore, authOpts: AuthOptions, opts: AppOptions = {}) {
  const ai = opts.ai ?? aiConfigFromEnv({})
  const build = opts.build ?? { version: null, sha: null }
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
    return c.json({ aiMode: aiModeFor(ai, user), user, build })
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
    if (body.image instanceof File) {
      const plan = await readPlanUpload(body.image)
      png = plan.png
      project.planImage = { file: 'plan.png', width: plan.width, height: plan.height }
      project.calibration.pxPerMeter = defaultPxPerMeter(plan.width, plan.height)
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

  /** Renames a project from the list, without the browser having to send the whole project back. */
  app.patch('/projects/:id', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
    if (!name) throw new HttpError(400, 'Mangler navn.')
    const project = await store.get(owner(c), c.req.param('id'))
    return c.json(await store.update(owner(c), { ...project, name }, project.version))
  })

  /** A copy of everything in the project: variants, furniture, chat and the floor plan. */
  app.post('/projects/:id/copy', async (c) => {
    const source = await store.get(owner(c), c.req.param('id'))
    const png = source.planImage
      ? await store.getPlan(owner(c), source.id).catch((e: unknown) => {
          // The project says it has a plan, but the image is gone: copy it without one
          if (e instanceof HttpError && e.status === 404) return null
          throw e
        })
      : null
    const now = new Date().toISOString()
    const suffix = ' (kopi)'
    const copy: Project = {
      ...source,
      id: newId('p_'),
      name: source.name.slice(0, MAX_NAME - suffix.length) + suffix,
      planImage: png ? source.planImage : null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    }
    return c.json(await store.create(owner(c), copy, png), 201)
  })

  /**
   * A small drawing of the active variant, for the project list. The SVG holds numbers and our own
   * colours only (see planThumbnailSvg), and the CSP keeps it inert if someone opens it directly.
   */
  app.get('/projects/:id/thumbnail', async (c) => {
    const project = await store.get(owner(c), c.req.param('id'))
    const scenario = project.scenarios.find((s) => s.id === project.activeScenarioId) ?? project.scenarios[0]!
    return c.body(planThumbnailSvg(scenario), 200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, no-cache',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    })
  })

  /**
   * Adds or replaces the floor plan of an existing project. Only the image is stored here; the
   * client puts the returned planImage into the project and saves it the usual way (If-Match),
   * so this never competes with autosave over the project version.
   */
  app.put('/projects/:id/plan', async (c) => {
    const body = await c.req.parseBody()
    if (!(body.image instanceof File)) throw new HttpError(400, 'Mangler bilde.')
    const { png, width, height } = await readPlanUpload(body.image)
    await store.putPlan(owner(c), c.req.param('id'), png)
    // A new file name per upload lets the browser tell the new image from a cached old one
    return c.json({
      planImage: { file: `plan-${Date.now().toString(36)}.png`, width, height },
      pxPerMeter: defaultPxPerMeter(width, height),
    })
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
