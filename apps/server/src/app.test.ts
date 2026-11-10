import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Project, ProjectSummary } from '@romslig/shared'
import { buildInfoFromEnv, createApp } from './app.ts'
import type { LogLine } from './log.ts'
import { FileStore } from './storage/file.ts'
import type { ProjectStore } from './storage/index.ts'
import { makePng } from './testutil.ts'

let root = ''
let app: ReturnType<typeof createApp>
const as = (user: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { 'Remote-User': user, ...(init.headers as Record<string, string> | undefined) },
})

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'romslig-app-'))
  app = createApp(await FileStore.open(root), { mode: 'forward' })
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function createProject(user: string, withImage = true): Promise<Project> {
  const fd = new FormData()
  fd.set('name', 'Leilighet')
  if (withImage)
    fd.set('image', new File([makePng(400, 300) as Uint8Array<ArrayBuffer>], 'plan.png', { type: 'image/png' }))
  const res = await app.request('/api/projects', as(user, { method: 'POST', body: fd }))
  expect(res.status).toBe(201)
  return (await res.json()) as Project
}

describe('API', () => {
  it('answers health without login, everything else needs a user', async () => {
    expect((await app.request('/api/health')).status).toBe(200)
    expect((await app.request('/api/projects')).status).toBe(401)
    expect(await (await app.request('/api/me', as('kari'))).json()).toMatchObject({ id: 'kari' })
  })

  it('stores the uploaded PNG with its size and rejects non-PNG uploads', async () => {
    const p = await createProject('kari')
    expect(p.planImage).toEqual({ file: 'plan.png', width: 400, height: 300 })
    const plan = await app.request(`/api/projects/${p.id}/plan`, as('kari'))
    expect(plan.headers.get('content-type')).toBe('image/png')
    const fd = new FormData()
    fd.set('image', new File(['not a png'], 'x.jpg', { type: 'image/jpeg' }))
    expect((await app.request('/api/projects', as('kari', { method: 'POST', body: fd }))).status).toBe(400)
  })

  it('adds a floor plan to a project created without one', async () => {
    const p = await createProject('kari', false)
    const upload = (user: string, png: Uint8Array) => {
      const fd = new FormData()
      fd.set('image', new File([png as Uint8Array<ArrayBuffer>], 'plan.png', { type: 'image/png' }))
      return app.request(`/api/projects/${p.id}/plan`, as(user, { method: 'PUT', body: fd }))
    }
    const res = await upload('kari', makePng(600, 300))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { planImage: { width: number; height: number }; pxPerMeter: number }
    expect(body.planImage).toMatchObject({ width: 600, height: 300 })
    expect(body.pxPerMeter).toBe(40)
    expect((await app.request(`/api/projects/${p.id}/plan`, as('kari'))).status).toBe(200)
    // The project itself (and its version) is untouched; the client saves planImage into it
    expect(((await (await app.request(`/api/projects/${p.id}`, as('kari'))).json()) as Project).version).toBe(1)
    expect((await upload('ola', makePng(10, 10))).status).toBe(404)
  })

  it('reports the build version in /config (and nulls without one)', async () => {
    const cfg = async (a: ReturnType<typeof createApp>) =>
      (await (await a.request('/api/config', as('kari'))).json()) as { build: unknown }
    expect((await cfg(app)).build).toEqual({ version: null, sha: null })
    const built = createApp(
      await FileStore.open(root),
      { mode: 'forward' },
      {
        build: buildInfoFromEnv({ APP_VERSION: '0.3.0', GIT_SHA: 'abcdef1234567' }),
      },
    )
    expect((await cfg(built)).build).toEqual({ version: '0.3.0', sha: 'abcdef1234567' })
  })

  it('keeps the projects of different users apart', async () => {
    const p = await createProject('kari')
    expect((await app.request(`/api/projects/${p.id}`, as('ola'))).status).toBe(404)
    expect((await app.request(`/api/projects/${p.id}/plan`, as('ola'))).status).toBe(404)
    const list = (await (await app.request('/api/projects', as('ola'))).json()) as ProjectSummary[]
    expect(list.map((x) => x.id)).not.toContain(p.id)
  })

  it('renames a project, and refuses an empty name', async () => {
    const p = await createProject('kari', false)
    const rename = (user: string, body: string) =>
      app.request(
        `/api/projects/${p.id}`,
        as(user, { method: 'PATCH', body, headers: { 'Content-Type': 'application/json' } }),
      )
    const res = await rename('kari', JSON.stringify({ name: '  Hytta (Ås)  ' }))
    expect(res.status).toBe(200)
    expect((await res.json()) as Project).toMatchObject({ name: 'Hytta (Ås)', version: 2 })
    const list = (await (await app.request('/api/projects', as('kari'))).json()) as ProjectSummary[]
    expect(list.find((x) => x.id === p.id)?.name).toBe('Hytta (Ås)')
    expect((await rename('kari', JSON.stringify({ name: '   ' }))).status).toBe(400)
    expect((await rename('kari', JSON.stringify({ name: 7 }))).status).toBe(400)
    expect((await rename('kari', 'not json')).status).toBe(400)
    expect((await rename('kari', JSON.stringify({ name: 'x'.repeat(300) }))).status).toBe(200)
    const long = (await (await app.request(`/api/projects/${p.id}`, as('kari'))).json()) as Project
    expect(long.name).toHaveLength(200)
    expect((await rename('ola', JSON.stringify({ name: 'Mitt' }))).status).toBe(404)
  })

  it('copies a project with its content and floor plan, as a project of its own', async () => {
    const p = await createProject('kari')
    const walls = [
      { id: 'w1', a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, thickness: 0.2, height: 2.4 },
      { id: 'w2', a: { x: 5, y: 0 }, b: { x: 5, y: 3 }, thickness: 0.2, height: 2.4 },
    ]
    const edited = { ...p, ceilingHeight: 2.7, scenarios: [{ ...p.scenarios[0]!, walls }] }
    const save = await app.request(
      `/api/projects/${p.id}`,
      as('kari', {
        method: 'PUT',
        body: JSON.stringify(edited),
        headers: { 'Content-Type': 'application/json', 'If-Match': '1' },
      }),
    )
    expect(save.status).toBe(200)

    const res = await app.request(`/api/projects/${p.id}/copy`, as('kari', { method: 'POST' }))
    expect(res.status).toBe(201)
    const copy = (await res.json()) as Project
    expect(copy.id).not.toBe(p.id)
    expect(copy).toMatchObject({ name: 'Leilighet (kopi)', version: 1, ceilingHeight: 2.7, planImage: p.planImage })
    expect(copy.scenarios[0]!.walls).toHaveLength(2)
    expect((await app.request(`/api/projects/${copy.id}/plan`, as('kari'))).status).toBe(200)

    // The two live separate lives from here on
    expect((await app.request(`/api/projects/${p.id}`, as('kari', { method: 'DELETE' }))).status).toBe(204)
    expect((await app.request(`/api/projects/${copy.id}`, as('kari'))).status).toBe(200)
    expect((await app.request(`/api/projects/${copy.id}/plan`, as('kari'))).status).toBe(200)

    expect((await app.request(`/api/projects/${copy.id}/copy`, as('ola', { method: 'POST' }))).status).toBe(404)
    const bare = await createProject('kari', false)
    const bareCopy = await app.request(`/api/projects/${bare.id}/copy`, as('kari', { method: 'POST' }))
    expect(((await bareCopy.json()) as Project).planImage).toBeNull()
  })

  it('draws a thumbnail of the active variant as an inert SVG', async () => {
    const p = await createProject('kari', false)
    const thumbnail = (user: string) => app.request(`/api/projects/${p.id}/thumbnail`, as(user))
    const empty = await thumbnail('kari')
    expect(empty.status).toBe(200)
    expect(empty.headers.get('content-type')).toBe('image/svg+xml')
    expect(empty.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(empty.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await empty.text()).toContain('stroke-dasharray')

    const first = p.scenarios[0]!
    const wall = (id: string, bx: number) => ({
      id,
      a: { x: 0, y: 0 },
      b: { x: bx, y: 0 },
      thickness: 0.2,
      height: 2.4,
    })
    const edited = {
      ...p,
      scenarios: [
        { ...first, walls: [wall('w1', 5)] },
        { ...first, id: 's_other', name: 'Åpen løsning', walls: [wall('w1', 5), wall('w2', 9)] },
      ],
      activeScenarioId: 's_other',
    }
    const save = await app.request(
      `/api/projects/${p.id}`,
      as('kari', {
        method: 'PUT',
        body: JSON.stringify(edited),
        headers: { 'Content-Type': 'application/json', 'If-Match': '1' },
      }),
    )
    expect(save.status).toBe(200)
    const svg = await (await thumbnail('kari')).text()
    expect(svg.match(/<path /g)).toHaveLength(2)
    expect(svg).not.toContain('Åpen')
    expect((await thumbnail('ola')).status).toBe(404)
  })

  it('requires If-Match on save and reports conflicts', async () => {
    const p = await createProject('kari', false)
    const put = (version: string | null, name: string) =>
      app.request(
        `/api/projects/${p.id}`,
        as('kari', {
          method: 'PUT',
          body: JSON.stringify({ ...p, name }),
          headers: { 'Content-Type': 'application/json', ...(version ? { 'If-Match': version } : {}) },
        }),
      )
    expect((await put(null, 'X')).status).toBe(428)
    const ok = await put('1', 'Fra PC')
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as Project).version).toBe(2)
    expect((await put('1', 'Fra mobil')).status).toBe(409)
    const saved = (await (await app.request(`/api/projects/${p.id}`, as('kari'))).json()) as Project
    expect(saved.name).toBe('Fra PC')
  })
})

describe('request log and errors', () => {
  const lines: LogLine[] = []
  let store: ProjectStore
  let logging: ReturnType<typeof createApp>
  const requests = () => lines.filter((l) => l.msg === 'request')

  beforeAll(async () => {
    store = await FileStore.open(root)
    logging = createApp(store, { mode: 'forward' }, { log: (line) => lines.push(line) })
  })
  beforeEach(() => {
    lines.length = 0
  })

  it('writes one line per request with route, status and user, and nothing of what was sent', async () => {
    const fd = new FormData()
    fd.set('name', 'Hemmelig hytte')
    const created = await logging.request('/api/projects?token=abc123', as('kari', { method: 'POST', body: fd }))
    const p = (await created.json()) as Project
    await logging.request(`/api/projects/${p.id}`, as('kari'))
    await logging.request('/api/projects')

    // The last one never reached an endpoint: the route is the login check that refused it
    expect(requests()).toEqual([
      expect.objectContaining({ method: 'POST', route: '/api/projects', path: '/api/projects', status: 201 }),
      expect.objectContaining({
        method: 'GET',
        route: '/api/projects/:id',
        path: `/api/projects/${p.id}`,
        user: 'kari',
      }),
      expect.objectContaining({
        level: 'info',
        method: 'GET',
        route: '/api/*',
        path: '/api/projects',
        status: 401,
        user: null,
      }),
    ])
    expect(lines).toHaveLength(3)
    expect(typeof requests()[0]!.ms).toBe('number')
    const text = JSON.stringify(lines)
    expect(text).not.toContain('Hemmelig')
    expect(text).not.toContain('abc123')
  })

  it('leaves the probes out, but not a health check that fails', async () => {
    expect((await logging.request('/api/health')).status).toBe(200)
    expect(lines).toEqual([])
    expect((await logging.request('/api/health/nothing-here')).status).toBe(401)
    expect(requests()).toHaveLength(1)
  })

  it('gives every answer a request id, and keeps one from the gateway when it is usable', async () => {
    const own = await logging.request('/api/me', as('kari'))
    expect(own.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(requests()[0]!.id).toBe(own.headers.get('x-request-id'))

    const kept = await logging.request('/api/me', as('kari', { headers: { 'X-Request-Id': 'gateway-1234abcd' } }))
    expect(kept.headers.get('x-request-id')).toBe('gateway-1234abcd')

    const replaced = await logging.request(
      '/api/me',
      as('kari', { headers: { 'X-Request-Id': 'not "usable" at all' } }),
    )
    expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)

    const plan = await logging.request('/api/projects/p_missing/plan', as('kari'))
    expect(plan.status).toBe(404)
    expect(plan.headers.get('x-request-id')).toBe(requests()[3]!.id)
  })

  it('answers an unforeseen error with a reference, and keeps what it said in the log', async () => {
    const broken: ProjectStore = Object.assign(Object.create(store) as ProjectStore, {
      list: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    })
    const failing = createApp(broken, { mode: 'forward' }, { log: (line) => lines.push(line) })
    const res = await failing.request('/api/projects', as('kari'))
    expect(res.status).toBe(500)
    const id = res.headers.get('x-request-id')
    const body = (await res.json()) as { error: string; requestId: string }
    expect(body.requestId).toBe(id)
    expect(body.error).toContain(id)
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')

    expect(lines).toEqual([
      expect.objectContaining({
        level: 'error',
        msg: 'error',
        id,
        error: 'Error',
        detail: 'connect ECONNREFUSED 10.0.0.5:5432',
      }),
      expect.objectContaining({
        level: 'error',
        msg: 'request',
        id,
        route: '/api/projects',
        status: 500,
        user: 'kari',
      }),
    ])
  })

  it('keeps the message of an error it raised itself', async () => {
    const res = await logging.request('/api/projects/p_missing', as('kari'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: expect.any(String) as string })
    expect(lines.filter((l) => l.msg === 'error')).toEqual([])
  })

  it('answers a body it cannot read with 400, not 500', async () => {
    const p = await createProject('kari', false)
    const save = await logging.request(
      `/api/projects/${p.id}`,
      as('kari', { method: 'PUT', body: '{"id": ', headers: { 'If-Match': '1', 'Content-Type': 'application/json' } }),
    )
    expect(save.status).toBe(400)
    const upload = await logging.request(
      `/api/projects/${p.id}/plan`,
      as('kari', { method: 'PUT', body: 'x', headers: { 'Content-Type': 'multipart/form-data; boundary=none' } }),
    )
    expect(upload.status).toBe(400)
    expect(lines.filter((l) => l.msg === 'error')).toEqual([])
  })
})
