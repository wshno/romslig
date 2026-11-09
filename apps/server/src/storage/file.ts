import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Project, type ProjectSummary } from '@romslig/shared'
import { HttpError } from '../errors.ts'
import type { ProjectStore } from './types.ts'

const safeId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new HttpError(400, 'Ugyldig prosjekt-id')
  return id
}

/** Owner ids can contain any characters; the folder name is a short hash of them. */
const ownerKey = (owner: string) => createHash('sha256').update(owner).digest('hex').slice(0, 16)

const exists = async (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/**
 * Projects as JSON files: <root>/<owner hash>/<project id>/{project.json,plan.png}. For local
 * development and single-user setups. Writes are serialised per project so the version check
 * is reliable within one process.
 */
export class FileStore implements ProjectStore {
  private locks = new Map<string, Promise<unknown>>()

  private constructor(private readonly root: string) {}

  /**
   * Opens the store. Projects saved before multi-user support (directly under root) are moved
   * to `legacyOwner`, so existing local work stays available.
   */
  static async open(root: string, legacyOwner: string | null = null): Promise<FileStore> {
    await mkdir(root, { recursive: true })
    const store = new FileStore(root)
    if (legacyOwner) await store.adoptLegacy(legacyOwner)
    return store
  }

  private async adoptLegacy(owner: string) {
    const target = path.join(this.root, ownerKey(owner))
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const dir = path.join(this.root, e.name)
      if (!(await exists(path.join(dir, 'project.json')))) continue
      await mkdir(target, { recursive: true })
      await rename(dir, path.join(target, e.name))
    }
  }

  private dir(owner: string, id: string) {
    return path.join(this.root, ownerKey(owner), safeId(id))
  }

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.locks.set(
      key,
      next.catch(() => undefined),
    )
    return next
  }

  async list(owner: string): Promise<ProjectSummary[]> {
    const base = path.join(this.root, ownerKey(owner))
    if (!(await exists(base))) return []
    const out: ProjectSummary[] = []
    for (const e of await readdir(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      try {
        const p = await this.get(owner, e.name)
        out.push({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt })
      } catch {
        // skip broken folders
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(owner: string, id: string): Promise<Project> {
    let raw: string
    try {
      raw = await readFile(path.join(this.dir(owner, id), 'project.json'), 'utf8')
    } catch {
      throw new HttpError(404, 'Fant ikke prosjektet')
    }
    return Project.parse(JSON.parse(raw))
  }

  async create(owner: string, project: Project, planPng: Uint8Array | null): Promise<Project> {
    const dir = this.dir(owner, project.id)
    await mkdir(dir, { recursive: true })
    if (planPng) await writeFile(path.join(dir, 'plan.png'), planPng)
    const saved = { ...project, version: 1, updatedAt: new Date().toISOString() }
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(saved, null, 2))
    return saved
  }

  update(owner: string, project: Project, expectedVersion: number): Promise<Project> {
    return this.withLock(`${owner}/${project.id}`, async () => {
      const current = await this.get(owner, project.id)
      if (current.version !== expectedVersion)
        throw new HttpError(409, 'Prosjektet er endret et annet sted siden du åpnet det.')
      const saved = { ...project, version: current.version + 1, updatedAt: new Date().toISOString() }
      await writeFile(path.join(this.dir(owner, project.id), 'project.json'), JSON.stringify(saved, null, 2))
      return saved
    })
  }

  async delete(owner: string, id: string): Promise<void> {
    await rm(this.dir(owner, id), { recursive: true, force: true })
  }

  async getPlan(owner: string, id: string): Promise<Uint8Array> {
    await this.get(owner, id) // 404 if the project is missing or owned by someone else
    try {
      return new Uint8Array(await readFile(path.join(this.dir(owner, id), 'plan.png')))
    } catch {
      throw new HttpError(404, 'Ingen plantegning')
    }
  }
}
