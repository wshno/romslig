import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Project, ProjectSummary } from '@romslig/shared'
import { buildInfoFromEnv, createApp } from './app.ts'
import { FileStore } from './storage/file.ts'
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

  const exportOf = async (user: string, id: string) => {
    const res = await app.request(`/api/projects/${id}/export`, as(user))
    expect(res.status).toBe(200)
    return { res, file: (await res.json()) as import('@romslig/shared').ProjectExport }
  }
  const importFile = (user: string, content: unknown) => {
    const fd = new FormData()
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    fd.set('file', new File([text], 'eksport.json', { type: 'application/json' }))
    return app.request('/api/projects/import', as(user, { method: 'POST', body: fd }))
  }
  const listOf = async (user: string) =>
    (await (await app.request('/api/projects', as(user))).json()) as ProjectSummary[]

  it('exports a project as one file and imports it as a new project, also for someone else', async () => {
    const p = await createProject('kari')
    const walls = [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, thickness: 0.2, height: 2.4 }]
    const edited = {
      ...p,
      name: 'Hytta på fjellet (Ål)',
      ceilingHeight: 2.7,
      scenarios: [{ ...p.scenarios[0]!, walls }],
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

    const { res, file } = await exportOf('kari', p.id)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="romslig-prosjekt\.json"; filename\*=UTF-8''romslig-hytta-p%C3%A5-fjellet-%C3%A5l-\d{4}-\d\d-\d\d\.json$/,
    )
    expect(file).toMatchObject({ format: 'romslig-project', version: 1, project: { id: p.id, name: edited.name } })
    const stored = new Uint8Array(await (await app.request(`/api/projects/${p.id}/plan`, as('kari'))).arrayBuffer())
    expect(Buffer.from(file.plan!, 'base64').equals(Buffer.from(stored))).toBe(true)
    expect((await app.request(`/api/projects/${p.id}/export`, as('ola'))).status).toBe(404)

    const before = (await listOf('kari')).length
    const imported = await importFile('ola', file)
    expect(imported.status).toBe(201)
    const copy = (await imported.json()) as Project
    expect(copy.id).not.toBe(p.id)
    expect(copy).toMatchObject({
      name: edited.name,
      version: 1,
      ceilingHeight: 2.7,
      calibration: p.calibration,
      planImage: { file: 'plan.png', width: 400, height: 300 },
      scenarios: [{ id: p.scenarios[0]!.id, walls }],
    })
    expect(copy.createdAt >= p.createdAt).toBe(true)
    const plan = await app.request(`/api/projects/${copy.id}/plan`, as('ola'))
    expect(Buffer.from(await plan.arrayBuffer()).equals(Buffer.from(stored))).toBe(true)
    // It is Ola's project now, and Kari has what she had
    expect((await app.request(`/api/projects/${copy.id}`, as('kari'))).status).toBe(404)
    expect(await listOf('kari')).toHaveLength(before)

    // A project without a plan exports and imports without one
    const bare = await createProject('kari', false)
    const bareFile = (await exportOf('kari', bare.id)).file
    expect(bareFile.plan).toBeNull()
    expect(((await (await importFile('kari', bareFile)).json()) as Project).planImage).toBeNull()
  })

  it('lets nothing in an imported file decide the id, version or owner', async () => {
    const victim = await createProject('kari')
    const { file } = await exportOf('kari', victim.id)
    const hostile = {
      ...file,
      project: { ...file.project, name: '   ', version: 99, activeScenarioId: 'finnes-ikke', ownerId: 'kari' },
    }
    const res = await importFile('ola', hostile)
    expect(res.status).toBe(201)
    const made = (await res.json()) as Project
    expect(made.id).not.toBe(victim.id)
    expect(made).toMatchObject({ name: 'Min leilighet', version: 1, activeScenarioId: victim.scenarios[0]!.id })
    expect(made).not.toHaveProperty('ownerId')
    const untouched = (await (await app.request(`/api/projects/${victim.id}`, as('kari'))).json()) as Project
    expect(untouched).toEqual(victim)

    // The file says there is a plan but carries none, or carries one the project does not mention
    const noImage = (await (await importFile('ola', { ...file, plan: null })).json()) as Project
    expect(noImage.planImage).toBeNull()
    const noMention = await importFile('ola', { ...file, project: { ...file.project, planImage: null } })
    const stray = (await noMention.json()) as Project
    expect(stray.planImage).toBeNull()
    expect((await app.request(`/api/projects/${stray.id}/plan`, as('ola'))).status).toBe(404)

    const long = await importFile('ola', { ...file, project: { ...file.project, name: 'x'.repeat(300) } })
    expect(((await long.json()) as Project).name).toHaveLength(200)
  })

  it('refuses a file that is not a sound export, and makes no project from it', async () => {
    const p = await createProject('nora')
    const { file } = await exportOf('nora', p.id)
    const before = (await listOf('nora')).length
    const refused = async (content: unknown, status: number, message: RegExp) => {
      const res = await importFile('nora', content)
      expect(res.status).toBe(status)
      expect(((await res.json()) as { error: string }).error).toMatch(message)
    }
    await refused('ikke json', 422, /ikke en Romslig-eksport/)
    await refused(p, 422, /ikke en Romslig-eksport/)
    await refused({ ...file, version: 2 }, 422, /nyere versjon/)
    await refused(
      { ...file, project: { ...file.project, scenarios: [] } },
      422,
      /skadet eller endret \(project\.scenarios/,
    )
    await refused({ ...file, plan: Buffer.from('ikke et bilde, bare tekst').toString('base64') }, 400, /PNG/)
    await refused({ ...file, plan: '%%%' }, 400, /PNG/)
    const other = Buffer.from(makePng(500, 300)).toString('base64')
    await refused({ ...file, plan: other }, 422, /andre mål/)

    const noFile = new FormData()
    noFile.set('file', 'tekst, ikke en fil')
    expect((await app.request('/api/projects/import', as('nora', { method: 'POST', body: noFile }))).status).toBe(400)
    const json = as('nora', {
      method: 'POST',
      body: JSON.stringify(file),
      headers: { 'Content-Type': 'application/json' },
    })
    expect((await app.request('/api/projects/import', json)).status).toBe(400)
    expect((await app.request('/api/projects/import', { method: 'POST', body: noFile })).status).toBe(401)

    const big = await importFile('nora', 'x'.repeat(25 * 1024 * 1024))
    expect(big.status).toBe(413)
    expect(await listOf('nora')).toHaveLength(before)
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
