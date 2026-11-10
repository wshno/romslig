import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomInt } from 'node:crypto'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makePng, makeProject } from '../testutil.ts'
import { FileStore } from './file.ts'
import { PostgresStore } from './postgres.ts'
import type { ProjectStore } from './types.ts'

/** The same behaviour is required from every store. */
function contract(name: string, open: () => Promise<ProjectStore>) {
  describe(`${name}`, () => {
    let store: ProjectStore
    beforeAll(async () => {
      store = await open()
    }, 120_000)
    afterAll(async () => {
      await store.close?.()
    })

    it('creates, reads and lists per owner', async () => {
      const p = await store.create('anna', makeProject('Annas'), makePng(10, 8))
      expect(p.version).toBe(1)
      expect((await store.get('anna', p.id)).name).toBe('Annas')
      expect((await store.list('anna')).map((x) => x.id)).toContain(p.id)
      expect(Array.from(await store.getPlan('anna', p.id)).slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47])
    })

    it('isolates owners: a project owned by someone else does not exist', async () => {
      const p = await store.create('anna', makeProject(), null)
      await expect(store.get('bjorn', p.id)).rejects.toMatchObject({ status: 404 })
      await expect(store.update('bjorn', p, 1)).rejects.toMatchObject({ status: 404 })
      await expect(store.getPlan('bjorn', p.id)).rejects.toMatchObject({ status: 404 })
      expect((await store.list('bjorn')).map((x) => x.id)).not.toContain(p.id)
      await store.delete('bjorn', p.id)
      expect((await store.get('anna', p.id)).id).toBe(p.id)
    })

    it('rejects a stale version with 409 and increments on success', async () => {
      const p = await store.create('anna', makeProject(), null)
      const v2 = await store.update('anna', { ...p, name: 'Endret' }, 1)
      expect(v2.version).toBe(2)
      expect(v2.name).toBe('Endret')
      await expect(store.update('anna', { ...p, name: 'Gammel fane' }, 1)).rejects.toMatchObject({ status: 409 })
      expect((await store.get('anna', p.id)).name).toBe('Endret')
    })

    it('adds and replaces a plan image later, only for the owner', async () => {
      const p = await store.create('anna', makeProject(), null)
      await expect(store.getPlan('anna', p.id)).rejects.toMatchObject({ status: 404 })
      await store.putPlan('anna', p.id, makePng(10, 8))
      await store.putPlan('anna', p.id, makePng(20, 6))
      expect(await store.getPlan('anna', p.id)).toHaveLength(makePng(20, 6).length)
      await expect(store.putPlan('bjorn', p.id, makePng(1, 1))).rejects.toMatchObject({ status: 404 })
      await expect(store.putPlan('anna', 'p_missing', makePng(1, 1))).rejects.toMatchObject({ status: 404 })
    })

    it('answers a ping', async () => {
      await expect(store.ping()).resolves.toBeUndefined()
    })

    it('deletes', async () => {
      const p = await store.create('anna', makeProject(), null)
      await store.delete('anna', p.id)
      await expect(store.get('anna', p.id)).rejects.toMatchObject({ status: 404 })
    })
  })
}

let fileRoot = ''
contract('FileStore', async () => {
  fileRoot = await mkdtemp(path.join(tmpdir(), 'romslig-files-'))
  return FileStore.open(fileRoot)
})

describe('FileStore legacy layout', () => {
  it('moves projects from before multi-user support to the legacy owner', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'romslig-legacy-'))
    const p = makeProject('Gammel')
    await mkdir(path.join(root, p.id))
    await writeFile(path.join(root, p.id, 'project.json'), JSON.stringify(p))
    const store = await FileStore.open(root, 'dev')
    expect((await store.get('dev', p.id)).name).toBe('Gammel')
    await rm(root, { recursive: true, force: true })
  })
})

describe('FileStore ping', () => {
  it('fails once its directory is gone, e.g. an unmounted volume', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'romslig-ping-'))
    const store = await FileStore.open(root)
    await expect(store.ping()).resolves.toBeUndefined()
    await rm(root, { recursive: true, force: true })
    await expect(store.ping()).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

// Real PostgreSQL from embedded binaries, so no Docker is needed
let pgServer: EmbeddedPostgres | null = null
let pgDir = ''
let closedPg: PostgresStore | null = null
contract('PostgresStore', async () => {
  pgDir = await mkdtemp(path.join(tmpdir(), 'romslig-pg-'))
  const port = randomInt(55000, 56000)
  pgServer = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: 'romslig',
    password: 'romslig',
    port,
    persistent: false,
    onLog: () => {},
  })
  await pgServer.initialise()
  await pgServer.start()
  await pgServer.createDatabase('romslig')
  const cfg = { host: 'localhost', port, database: 'romslig', user: 'romslig', password: 'romslig', ssl: false }
  const store = await PostgresStore.open(cfg)
  // Opening a second time must not re-run applied migrations
  closedPg = await PostgresStore.open(cfg)
  await closedPg.close()
  return store
})

describe('PostgresStore ping', () => {
  it('fails once the pool is closed', async () => {
    expect(closedPg).not.toBeNull()
    await expect(closedPg!.ping()).rejects.toThrow()
  })
})

afterAll(async () => {
  await pgServer?.stop()
  if (fileRoot) await rm(fileRoot, { recursive: true, force: true })
  if (pgDir) await rm(pgDir, { recursive: true, force: true }).catch(() => undefined)
}, 60_000)
