import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Project, ProjectSummary } from '@romslig/shared'
import { createApp } from './app.ts'
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

  it('keeps the projects of different users apart', async () => {
    const p = await createProject('kari')
    expect((await app.request(`/api/projects/${p.id}`, as('ola'))).status).toBe(404)
    expect((await app.request(`/api/projects/${p.id}/plan`, as('ola'))).status).toBe(404)
    const list = (await (await app.request('/api/projects', as('ola'))).json()) as ProjectSummary[]
    expect(list.map((x) => x.id)).not.toContain(p.id)
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
