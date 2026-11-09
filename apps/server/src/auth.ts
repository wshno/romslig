import type { MiddlewareHandler } from 'hono'
import { HttpError } from './errors.ts'

export interface User {
  /** Stable id from the identity provider (Authelia: the username). */
  id: string
  email: string | null
  name: string | null
  groups: string[]
}

export type AuthMode = 'forward' | 'dev'

export interface AuthOptions {
  mode: AuthMode
  /** If set, users must be in this group. */
  allowedGroup?: string | null
}

export const DEV_USER: User = { id: 'dev', email: 'dev@localhost', name: 'Utvikler', groups: ['romslig-users'] }

export function authOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): AuthOptions {
  const mode = env.AUTH_MODE ?? (env.NODE_ENV === 'production' ? 'forward' : 'dev')
  if (mode !== 'forward' && mode !== 'dev') throw new Error(`Unknown AUTH_MODE "${mode}"`)
  return { mode, allowedGroup: env.ALLOWED_GROUP?.trim() || null }
}

/**
 * Identifies the user. In "forward" mode the identity comes from the headers Authelia's
 * forward-auth middleware sets at the gateway (Traefik overwrites any client-supplied values,
 * and network policy only admits traffic from Traefik). "dev" mode uses a fixed local user.
 */
export function auth(opts: AuthOptions): MiddlewareHandler<{ Variables: { user: User } }> {
  return async (c, next) => {
    let user: User
    if (opts.mode === 'dev') user = DEV_USER
    else {
      const id = c.req.header('Remote-User')?.trim()
      if (!id) throw new HttpError(401, 'Ikke innlogget.')
      user = {
        id,
        email: c.req.header('Remote-Email')?.trim() || null,
        name: c.req.header('Remote-Name')?.trim() || null,
        groups: (c.req.header('Remote-Groups') ?? '')
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
      }
    }
    if (opts.allowedGroup && !user.groups.includes(opts.allowedGroup))
      throw new HttpError(403, 'Du har ikke tilgang til Romslig.')
    c.set('user', user)
    await next()
  }
}
