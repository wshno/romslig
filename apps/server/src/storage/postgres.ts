import pg from 'pg'
import { Project, type ProjectSummary } from '@romslig/shared'
import { HttpError } from '../errors.ts'
import type { ProjectStore } from './types.ts'

/** Ordered schema migrations; each runs once, in a transaction. Never edit an applied one. */
const MIGRATIONS: string[] = [
  `create table projects (
     id text primary key,
     owner text not null,
     name text not null,
     data jsonb not null,
     version integer not null,
     created_at timestamptz not null,
     updated_at timestamptz not null
   );
   create index projects_owner_updated_idx on projects (owner, updated_at desc);
   create table plan_images (
     project_id text primary key references projects (id) on delete cascade,
     png bytea not null
   );`,
]

export interface PgConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl: boolean
}

export function pgConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PgConfig | null {
  if (!env.PG_HOST) return null
  return {
    host: env.PG_HOST,
    port: Number(env.PG_PORT ?? 5432),
    database: env.PG_DB ?? 'romslig',
    user: env.PG_USER ?? 'romslig',
    password: env.PG_PASSWORD ?? '',
    ssl: env.PG_SSL === 'true',
  }
}

interface Row {
  id: string
  name: string
  data: unknown
  version: number
  created_at: Date
  updated_at: Date
}

/** Projects as JSONB rows, plan images as bytea. Version checks happen in the UPDATE itself. */
export class PostgresStore implements ProjectStore {
  private constructor(private readonly pool: pg.Pool) {}

  static async open(cfg: PgConfig): Promise<PostgresStore> {
    const pool = new pg.Pool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
    })
    const store = new PostgresStore(pool)
    await store.migrate()
    return store
  }

  private async migrate() {
    const client = await this.pool.connect()
    try {
      // Serialise migrations across replicas
      await client.query('select pg_advisory_lock(727274)')
      await client.query(
        'create table if not exists schema_migrations (version integer primary key, applied_at timestamptz not null default now())',
      )
      const { rows } = await client.query<{ version: number }>('select version from schema_migrations')
      const applied = new Set(rows.map((r) => r.version))
      for (const [i, sql] of MIGRATIONS.entries()) {
        const version = i + 1
        if (applied.has(version)) continue
        await client.query('begin')
        try {
          await client.query(sql)
          await client.query('insert into schema_migrations (version) values ($1)', [version])
          await client.query('commit')
        } catch (e) {
          await client.query('rollback')
          throw e
        }
      }
    } finally {
      await client.query('select pg_advisory_unlock(727274)').catch(() => undefined)
      client.release()
    }
  }

  private toProject(row: Row): Project {
    return Project.parse({
      ...(row.data as object),
      id: row.id,
      name: row.name,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })
  }

  async list(owner: string): Promise<ProjectSummary[]> {
    const { rows } = await this.pool.query<Omit<Row, 'data' | 'version'>>(
      'select id, name, created_at, updated_at from projects where owner = $1 order by updated_at desc',
      [owner],
    )
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }))
  }

  async get(owner: string, id: string): Promise<Project> {
    const { rows } = await this.pool.query<Row>(
      'select id, name, data, version, created_at, updated_at from projects where id = $1 and owner = $2',
      [id, owner],
    )
    if (!rows[0]) throw new HttpError(404, 'Fant ikke prosjektet')
    return this.toProject(rows[0])
  }

  async create(owner: string, project: Project, planPng: Uint8Array | null): Promise<Project> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query<Row>(
        `insert into projects (id, owner, name, data, version, created_at, updated_at)
         values ($1, $2, $3, $4, 1, $5, now())
         returning id, name, data, version, created_at, updated_at`,
        [project.id, owner, project.name, JSON.stringify(project), project.createdAt],
      )
      if (planPng)
        await client.query('insert into plan_images (project_id, png) values ($1, $2)', [
          project.id,
          Buffer.from(planPng),
        ])
      await client.query('commit')
      return this.toProject(rows[0]!)
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  }

  async update(owner: string, project: Project, expectedVersion: number): Promise<Project> {
    const { rows } = await this.pool.query<Row>(
      `update projects set name = $1, data = $2, version = version + 1, updated_at = now()
       where id = $3 and owner = $4 and version = $5
       returning id, name, data, version, created_at, updated_at`,
      [project.name, JSON.stringify(project), project.id, owner, expectedVersion],
    )
    if (rows[0]) return this.toProject(rows[0])
    const exists = await this.pool.query('select 1 from projects where id = $1 and owner = $2', [project.id, owner])
    if (exists.rowCount) throw new HttpError(409, 'Prosjektet er endret et annet sted siden du åpnet det.')
    throw new HttpError(404, 'Fant ikke prosjektet')
  }

  async delete(owner: string, id: string): Promise<void> {
    await this.pool.query('delete from projects where id = $1 and owner = $2', [id, owner])
  }

  async putPlan(owner: string, id: string, png: Uint8Array): Promise<void> {
    // Only inserts when the project exists and belongs to the owner
    const { rowCount } = await this.pool.query(
      `insert into plan_images (project_id, png)
       select id, $3 from projects where id = $1 and owner = $2
       on conflict (project_id) do update set png = excluded.png`,
      [id, owner, Buffer.from(png)],
    )
    if (!rowCount) throw new HttpError(404, 'Fant ikke prosjektet')
  }

  async getPlan(owner: string, id: string): Promise<Uint8Array> {
    const { rows } = await this.pool.query<{ png: Buffer }>(
      `select i.png from plan_images i join projects p on p.id = i.project_id where p.id = $1 and p.owner = $2`,
      [id, owner],
    )
    if (!rows[0]) throw new HttpError(404, 'Ingen plantegning')
    return new Uint8Array(rows[0].png)
  }

  async close() {
    await this.pool.end()
  }
}
