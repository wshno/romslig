import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  Project,
  emptyScenario,
  exportFileName,
  newId,
  planThumbnailSvg,
  readProjectExport,
  type ProjectExport,
} from '@romslig/shared'
import { auth, type AuthOptions, type User } from './auth.ts'
import { HttpError } from './errors.ts'
import { jsonLog, requestLog, type Log } from './log.ts'
import { MAX_PLAN_BYTES, readPngSize } from './png.ts'
import type { ProjectStore } from './storage/index.ts'
import { aiConfigFromEnv, aiModeFor, type AiConfig } from './ai/config.ts'
import { aiProxy } from './ai/proxy.ts'

type Env = { Variables: { user: User; requestId: string } }

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

/** What the client sent. A body that cannot be read is the client's mistake (400), not ours (500). */
const sent = <T>(body: Promise<T>): Promise<T> =>
  body.catch(() => {
    throw new HttpError(400, 'Kunne ikke lese forespørselen.')
  })

/** Default scale until calibrated: assume the plan is about 15 m across. */
const defaultPxPerMeter = (width: number, height: number) => Math.max(width, height) / 15

/** Longest project name we store. */
const MAX_NAME = 200

/** A readiness check that has not answered by now counts as failed; the probe gives up at 1 s by default. */
const READY_TIMEOUT_MS = 800
const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** Largest export we read: a floor plan of the largest size as base64, and 4 MB for the project. */
const MAX_IMPORT_BYTES = Math.ceil(MAX_PLAN_BYTES / 3) * 4 + 4 * 1024 * 1024

export interface AppOptions {
  ai?: AiConfig
  /** Version of this build (APP_VERSION / GIT_SHA from the image), shown in the web footer. */
  build?: BuildInfo
  /** Used by the AI proxy to reach Anthropic (tests inject a fake). */
  fetch?: typeof fetch
  /** Where log lines go. Defaults to JSON on stdout. */
  log?: Log
}

/**
 * The HTTP API. Everything except /health requires a user (see auth.ts). The AI features run in
 * the browser; the API only tells it which mode to use and, in server mode, proxies its calls.
 */
export function createApp(store: ProjectStore, authOpts: AuthOptions, opts: AppOptions = {}) {
  const ai = opts.ai ?? aiConfigFromEnv({})
  const build = opts.build ?? { version: null, sha: null }
  const log = opts.log ?? jsonLog
  const app = new Hono<Env>().basePath('/api')

  app.use('*', requestLog(log))

  // An error we did not foresee. What it says may name tables, files or hosts, so it goes to the
  // log, and the client gets the id to find it by.
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
    const id = c.get('requestId')
    log({ level: 'error', msg: 'error', id, error: err.name, detail: err.message, stack: err.stack ?? null })
    return c.json({ error: `Noe gikk galt hos Romslig. Referanse: ${id}`, requestId: id }, 500)
  })

  // Unauthenticated, for the Kubernetes probes. /health (liveness) only says the process answers, so a
  // database outage does not get the pod restarted; /health/ready (readiness) also asks the store, so
  // the pod gets no traffic while it cannot serve it. Why the store failed goes to the log only.
  app.get('/health', (c) => c.json({ ok: true }))
  app.get('/health/ready', async (c) => {
    try {
      await withTimeout(store.ping(), READY_TIMEOUT_MS)
      return c.json({ ok: true })
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      log({ level: 'error', msg: 'not ready', id: c.get('requestId'), error: e.name, detail: e.message })
      return c.json({ ok: false }, 503)
    }
  })

  app.use('*', auth(authOpts))
  const owner = (c: { get(key: 'user'): User }) => c.get('user').id

  app.get('/me', (c) => c.json(c.get('user')))

  /** What the browser needs to start: the user's AI mode (never the key) and who they are. */
  app.get('/config', (c) => {
    const user = c.get('user')
    return c.json({ aiMode: aiModeFor(ai, user), user, build })
  })

  app.route('/ai', aiProxy(ai, opts.fetch, undefined, log))

  app.get('/projects', async (c) => c.json(await store.list(owner(c))))

  app.post('/projects', async (c) => {
    const body = await sent(c.req.parseBody())
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
    const parsed = Project.safeParse(await sent(c.req.json()))
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

  /** The floor plan of a project, or null if it has none (or says it has one that is gone). */
  const planOf = async (user: string, project: Project) =>
    project.planImage
      ? store.getPlan(user, project.id).catch((e: unknown) => {
          if (e instanceof HttpError && e.status === 404) return null
          throw e
        })
      : null

  /** A copy of everything in the project: variants, furniture, chat and the floor plan. */
  app.post('/projects/:id/copy', async (c) => {
    const source = await store.get(owner(c), c.req.param('id'))
    const png = await planOf(owner(c), source)
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

  /** The project as one file to keep or to import somewhere else (see ProjectExport). */
  app.get('/projects/:id/export', async (c) => {
    const project = await store.get(owner(c), c.req.param('id'))
    const png = await planOf(owner(c), project)
    const now = new Date()
    const file: ProjectExport = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      project: png ? project : { ...project, planImage: null },
      plan: png ? Buffer.from(png).toString('base64') : null,
    }
    const name = encodeURIComponent(exportFileName(project.name, now))
    return c.json(file, 200, {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="romslig-prosjekt.json"; filename*=UTF-8''${name}`,
    })
  })

  /**
   * Makes a new project from an exported file. The file is checked like a save is (the Project
   * schema), and the floor plan like an upload. Nothing in it decides the id, owner or version.
   */
  const importLimit = bodyLimit({
    // The form around the file takes a little room of its own
    maxSize: MAX_IMPORT_BYTES + 64 * 1024,
    onError: () => {
      throw new HttpError(413, 'Filen er for stor.')
    },
  })
  app.post('/projects/import', importLimit, async (c) => {
    const body = await c.req.parseBody().catch((e: unknown) => {
      if (e instanceof HttpError) throw e
      return null
    })
    const upload = body?.file
    if (!(upload instanceof File)) throw new HttpError(400, 'Mangler fil.')
    const read = readProjectExport(await upload.text())
    if (!read.ok) throw new HttpError(422, read.error)
    const { project: source, plan } = read.file
    let png: Uint8Array | null = null
    if (source.planImage && plan) {
      png = new Uint8Array(Buffer.from(plan, 'base64'))
      const { width, height } = readPngSize(png)
      // The plan is laid under the drawing by these numbers, so they have to be the image's own
      if (width !== source.planImage.width || height !== source.planImage.height)
        throw new HttpError(422, 'Plantegningen i filen har andre mål enn prosjektet oppgir.')
    }
    const now = new Date().toISOString()
    const project: Project = {
      ...source,
      id: newId('p_'),
      name: source.name.trim().slice(0, MAX_NAME) || 'Min leilighet',
      planImage: png && source.planImage ? { ...source.planImage, file: 'plan.png' } : null,
      activeScenarioId: source.scenarios.some((s) => s.id === source.activeScenarioId)
        ? source.activeScenarioId
        : source.scenarios[0]!.id,
      version: 0,
      createdAt: now,
      updatedAt: now,
    }
    return c.json(await store.create(owner(c), project, png), 201)
  })

  /**
   * Adds or replaces the floor plan of an existing project. Only the image is stored here; the
   * client puts the returned planImage into the project and saves it the usual way (If-Match),
   * so this never competes with autosave over the project version.
   */
  app.put('/projects/:id/plan', async (c) => {
    const body = await sent(c.req.parseBody())
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
