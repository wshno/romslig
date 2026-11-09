import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { auth, authOptionsFromEnv, type AuthOptions, type User } from './auth.ts'
import { HttpError } from './errors.ts'

function app(opts: AuthOptions) {
  const a = new Hono<{ Variables: { user: User } }>()
  a.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.message }, err.status) : c.text('x', 500)))
  a.use('*', auth(opts))
  a.get('/me', (c) => c.json(c.get('user')))
  return a
}

describe('auth', () => {
  it('uses a fixed user in dev mode', async () => {
    const res = await app({ mode: 'dev' }).request('/me')
    expect(((await res.json()) as User).id).toBe('dev')
  })

  it('requires Remote-User in forward mode and parses the other headers', async () => {
    const a = app({ mode: 'forward' })
    expect((await a.request('/me')).status).toBe(401)
    const res = await a.request('/me', {
      headers: { 'Remote-User': 'kari', 'Remote-Email': 'kari@example.no', 'Remote-Groups': 'romslig-users, family' },
    })
    expect(await res.json()).toEqual({
      id: 'kari',
      email: 'kari@example.no',
      name: null,
      groups: ['romslig-users', 'family'],
    })
  })

  it('enforces the allowed group', async () => {
    const a = app({ mode: 'forward', allowedGroup: 'romslig-users' })
    const other = await a.request('/me', { headers: { 'Remote-User': 'ola', 'Remote-Groups': 'other' } })
    expect(other.status).toBe(403)
    const member = await a.request('/me', { headers: { 'Remote-User': 'ola', 'Remote-Groups': 'romslig-users' } })
    expect(member.status).toBe(200)
  })

  it('defaults to forward auth in production', () => {
    expect(authOptionsFromEnv({ NODE_ENV: 'production' }).mode).toBe('forward')
    expect(authOptionsFromEnv({}).mode).toBe('dev')
    expect(authOptionsFromEnv({ AUTH_MODE: 'forward', ALLOWED_GROUP: ' g ' })).toEqual({
      mode: 'forward',
      allowedGroup: 'g',
    })
    expect(() => authOptionsFromEnv({ AUTH_MODE: 'none' })).toThrow()
  })
})
