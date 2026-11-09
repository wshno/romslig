import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEV_USER, type AuthOptions } from '../auth.ts'
import { FileStore } from './file.ts'
import { PostgresStore, pgConfigFromEnv } from './postgres.ts'
import type { ProjectStore } from './types.ts'

export type { ProjectStore } from './types.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.ROMSLIG_DATA_DIR ?? path.resolve(here, '../../../../data/projects')

/** Postgres when PG_HOST is set, otherwise JSON files under DATA_DIR. */
export async function openStore(authOpts: AuthOptions, env: NodeJS.ProcessEnv = process.env): Promise<ProjectStore> {
  const pg = pgConfigFromEnv(env)
  if (pg) return PostgresStore.open(pg)
  // Local single-user work from before multi-user support belongs to the dev user
  return FileStore.open(DATA_DIR, authOpts.mode === 'dev' ? DEV_USER.id : null)
}
