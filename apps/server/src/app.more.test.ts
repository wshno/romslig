import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Project } from '@romslig/shared'
import { createApp } from './app.ts'
import { MAX_PLAN_BYTES } from './png.ts'
import { FileStore } from './storage/file.ts'

let root = ''
let app: ReturnType<typeof createApp>
const as = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { 'Remote-User': 'kari', ...(init.headers as Record<string, string> | undefined) },
})

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'romslig-app-more-'))
  app = createApp(await FileStore.open(root), { mode: 'forward' })
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function createProject(): Promise<Project> {
  const fd = new FormData()
  fd.set('name', 'Hytte')
  const res = await app.request('/api/projects', as({ method: 'POST', body: fd }))
  return (await res.json()) as Project
}

const put = (p: Project, body: unknown, ifMatch = '1') =>
  app.request(
    `/api/projects/${p.id}`,
    as({
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'If-Match': ifMatch },
    }),
  )

describe('saving a project', () => {
  it('refuses a version that is not a whole number', async () => {
    const p = await createProject()
    const res = await put(p, p, '"v1"')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Ugyldig If-Match.' })
  })

  it('refuses project data that does not hold up', async () => {
    const p = await createProject()
    const res = await put(p, { ...p, scenarios: 'ingen' })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toMatch(/^Ugyldig prosjektdata/)
  })

  it('refuses a project sent to the address of another', async () => {
    const p = await createProject()
    const res = await put(p, { ...p, id: 'p_other' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Id stemmer ikke' })
  })
})

describe('uploading a floor plan', () => {
  const upload = (p: Project, fd: FormData) =>
    app.request(`/api/projects/${p.id}/plan`, as({ method: 'PUT', body: fd }))

  it('needs an image', async () => {
    const p = await createProject()
    const fd = new FormData()
    fd.set('name', 'ikke et bilde')
    const res = await upload(p, fd)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Mangler bilde.' })
  })

  it('refuses an image over the limit', async () => {
    const p = await createProject()
    const fd = new FormData()
    fd.set('image', new File([new Uint8Array(MAX_PLAN_BYTES + 1)], 'plan.png', { type: 'image/png' }))
    const res = await upload(p, fd)
    expect(res.status).toBe(413)
  })
})
