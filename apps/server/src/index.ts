import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { Project, emptyScenario, newId } from '@romslig/shared'
import { HttpError, deleteProject, listProjects, loadProject, projectDir, saveProject } from './storage.ts'
import { digitizeProject } from './ai/digitize.ts'
import { AssistantRequest, runAssistant } from './ai/assistant.ts'
import { RecognizeRequest, recognizeFurniture } from './ai/recognize.ts'
import { streamSSE } from 'hono/streaming'

const app = new Hono().basePath('/api')

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: err.message || 'Ukjent feil' }, 500)
})

app.get('/health', (c) =>
  c.json({ ok: true, ai: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) }),
)

app.get('/projects', async (c) => c.json(await listProjects()))

app.post('/projects', async (c) => {
  const body = await c.req.parseBody()
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Min leilighet'
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
    createdAt: now,
    updatedAt: now,
  }
  const image = body.image
  if (image instanceof File) {
    const dir = projectDir(project.id)
    await mkdir(dir, { recursive: true })
    let png: Buffer
    try {
      png = await sharp(Buffer.from(await image.arrayBuffer()))
        .rotate()
        .png()
        .toBuffer()
    } catch {
      throw new HttpError(400, 'Klarte ikke å lese bildet. Bruk JPG eller PNG.')
    }
    const meta = await sharp(png).metadata()
    await writeFile(path.join(dir, 'plan.png'), png)
    project.planImage = { file: 'plan.png', width: meta.width!, height: meta.height! }
    // Default scale: assume the plan is ~15 m across until calibrated
    project.calibration.pxPerMeter = Math.max(meta.width!, meta.height!) / 15
  }
  return c.json(await saveProject(project), 201)
})

app.get('/projects/:id', async (c) => c.json(await loadProject(c.req.param('id'))))

app.put('/projects/:id', async (c) => {
  const parsed = Project.safeParse(await c.req.json())
  if (!parsed.success) throw new HttpError(422, 'Ugyldig prosjektdata: ' + parsed.error.message)
  if (parsed.data.id !== c.req.param('id')) throw new HttpError(400, 'Id stemmer ikke')
  return c.json(await saveProject(parsed.data))
})

app.delete('/projects/:id', async (c) => {
  await deleteProject(c.req.param('id'))
  return c.body(null, 204)
})

app.get('/projects/:id/plan', async (c) => {
  const p = await loadProject(c.req.param('id'))
  if (!p.planImage) throw new HttpError(404, 'Ingen plantegning')
  const buf = await readFile(path.join(projectDir(p.id), p.planImage.file))
  return c.body(new Uint8Array(buf), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' })
})

app.post('/projects/:id/digitize', async (c) => {
  const p = await loadProject(c.req.param('id'))
  return c.json(await digitizeProject(p))
})

app.post('/projects/:id/recognize', async (c) => {
  const parsed = RecognizeRequest.safeParse(await c.req.json())
  if (!parsed.success) throw new HttpError(422, 'Ugyldig forespørsel: ' + parsed.error.message)
  if (parsed.data.project.id !== c.req.param('id')) throw new HttpError(400, 'Id stemmer ikke')
  return c.json(await recognizeFurniture(parsed.data))
})

app.post('/projects/:id/assistant', async (c) => {
  const parsed = AssistantRequest.safeParse(await c.req.json())
  if (!parsed.success) throw new HttpError(422, 'Ugyldig forespørsel: ' + parsed.error.message)
  if (parsed.data.project.id !== c.req.param('id')) throw new HttpError(400, 'Id stemmer ikke')
  return streamSSE(c, async (stream) => {
    const abort = new AbortController()
    stream.onAbort(() => abort.abort())
    // Events are written in order; the stream stays open until the assistant is done
    let queue = Promise.resolve()
    await runAssistant(
      parsed.data,
      (event) => {
        queue = queue.then(() => stream.writeSSE({ data: JSON.stringify(event) }))
      },
      abort.signal,
    )
    await queue
  })
})

const port = Number(process.env.PORT ?? 8787)
const server = serve({ fetch: app.fetch, port }, () => console.log(`API: http://localhost:${port}/api`))

// tsx watch restarts the process on every change. On Windows the previous process can hold the
// port for a moment, so retry instead of crashing, and release the port promptly on shutdown.
let retries = 0
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE' || retries++ >= 20) throw err
  setTimeout(() => server.listen(port), 250)
})
const shutdown = () => server.close(() => process.exit(0))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
