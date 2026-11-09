import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { FileStore } from '../storage/file.ts'
import type { ProjectStore } from '../storage/index.ts'
import { aiConfigFromEnv, type AiConfig } from './config.ts'
import { RateLimiter } from './proxy.ts'

const SERVER_KEY = 'sk-ant-server-secret-123'
const CLIENT_KEY = 'sk-ant-browser-key-456'

/** A fake Anthropic: records each request and answers with SSE (stream: true) or JSON. */
let upstream: Server
let upstreamUrl = ''
let received: { headers: IncomingHttpHeaders; body: string }[] = []

const SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hei"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
]

let root = ''
let store: ProjectStore

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      received.push({ headers: req.headers, body })
      const parsed = JSON.parse(body) as { stream?: boolean }
      if (parsed.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_1', 'x-internal': 'secret' })
        // Written in pieces, like the real API
        let i = 0
        const tick = () => {
          if (i < SSE.length) {
            res.write(SSE[i++])
            setTimeout(tick, 5)
          } else res.end()
        }
        tick()
      } else {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'msg_1', content: [], usage: { input_tokens: 3, output_tokens: 4 } }))
      }
    })
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  root = await mkdtemp(path.join(tmpdir(), 'romslig-proxy-'))
  store = await FileStore.open(root)
})

afterAll(async () => {
  await new Promise((resolve) => upstream.close(resolve))
  await rm(root, { recursive: true, force: true })
})

beforeEach(() => {
  received = []
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

function config(env: NodeJS.ProcessEnv = {}): AiConfig {
  return aiConfigFromEnv(
    { AI_MODE: 'server', ANTHROPIC_API_KEY: SERVER_KEY, ANTHROPIC_BASE_URL: upstreamUrl, ...env },
    () => undefined,
  )
}

function appWith(cfg: AiConfig) {
  return createApp(store, { mode: 'forward' }, { ai: cfg })
}

const message = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    model: 'claude-opus-5-5',
    max_tokens: 1000,
    messages: [{ role: 'user', content: 'Hei' }],
    ...extra,
  })

function post(app: ReturnType<typeof appWith>, body: string, headers: Record<string, string> = {}, user = 'kari') {
  return app.request('/api/ai/v1/messages', {
    method: 'POST',
    body,
    headers: {
      'Remote-User': user,
      'Remote-Groups': 'romslig-users',
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'x-api-key': CLIENT_KEY,
      authorization: `Bearer ${CLIENT_KEY}`,
      'anthropic-dangerous-direct-browser-access': 'true',
      ...headers,
    },
  })
}

/** Everything the browser gets back, for checking that the server key never leaks. */
async function dump(res: Response) {
  return JSON.stringify([...res.headers.entries()]) + (await res.text())
}

describe('AI proxy', () => {
  it('replaces the key and never forwards the client key or browser header', async () => {
    const res = await post(appWith(config()), message())
    expect(res.status).toBe(200)
    expect(received).toHaveLength(1)
    const h = received[0]!.headers
    expect(h['x-api-key']).toBe(SERVER_KEY)
    expect(h.authorization).toBeUndefined()
    expect(h['anthropic-dangerous-direct-browser-access']).toBeUndefined()
    expect(h['remote-user']).toBeUndefined()
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(h['anthropic-beta']).toBe('server-side-fallback-2026-07-01')
    expect(JSON.stringify(received)).not.toContain(CLIENT_KEY)
    // The body is forwarded unchanged
    expect(received[0]!.body).toBe(message())
    expect(await dump(res)).not.toContain(SERVER_KEY)
  })

  it('streams SSE through unchanged and logs usage, not content', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const res = await post(appWith(config()), message({ stream: true }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('request-id')).toBe('req_1')
    expect(res.headers.get('x-internal')).toBeNull()
    const reader = res.body!.getReader()
    const chunks: string[] = []
    const decoder = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value))
    }
    expect(chunks.join('')).toBe(SSE.join(''))
    expect(chunks.length).toBeGreaterThan(1)
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines).toEqual(['ai-proxy user=kari model=claude-opus-5-5 status=200 input_tokens=12 output_tokens=7'])
    expect(lines.join('')).not.toContain('Hei')
  })

  it('rejects models that are not allowed', async () => {
    const res = await post(appWith(config()), message({ model: 'claude-other-1' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } })
    expect(received).toHaveLength(0)
  })

  it('rejects max_tokens above the limit', async () => {
    const app = appWith(config({ AI_MAX_TOKENS: '2000' }))
    expect((await post(app, message({ max_tokens: 2001 }))).status).toBe(400)
    expect((await post(app, message({ max_tokens: '10' }))).status).toBe(400)
    expect((await post(app, message({ max_tokens: 2000 }))).status).toBe(200)
    expect(received).toHaveLength(1)
  })

  it('rejects bodies over 20 MB and invalid JSON', async () => {
    const app = appWith(config())
    const big = message({ padding: 'x'.repeat(20 * 1024 * 1024) })
    expect((await post(app, big)).status).toBe(413)
    expect((await post(app, '{nope')).status).toBe(400)
    expect(received).toHaveLength(0)
  })

  it('limits requests per user per minute', async () => {
    const app = appWith(config({ AI_RATE_PER_MIN: '2' }))
    expect((await post(app, message())).status).toBe(200)
    expect((await post(app, message())).status).toBe(200)
    const limited = await post(app, message())
    expect(limited.status).toBe(429)
    expect(limited.headers.get('x-should-retry')).toBe('false')
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    // Another user has their own budget
    expect((await post(app, message(), {}, 'ola')).status).toBe(200)
  })

  it('does not exist in byok mode', async () => {
    const res = await post(appWith(config({ AI_MODE: 'byok' })), message())
    expect(res.status).toBe(404)
    expect(received).toHaveLength(0)
  })

  it('does not exist in server mode without a key', async () => {
    const res = await post(appWith(config({ ANTHROPIC_API_KEY: '' })), message())
    expect(res.status).toBe(404)
  })

  it('does not exist for users outside AI_GROUP', async () => {
    const app = appWith(config({ AI_GROUP: 'romslig-ai' }))
    expect((await post(app, message())).status).toBe(404)
    expect((await post(app, message(), { 'Remote-Groups': 'romslig-users,romslig-ai' })).status).toBe(200)
    expect(received).toHaveLength(1)
  })

  it('requires login', async () => {
    const res = await appWith(config()).request('/api/ai/v1/messages', { method: 'POST', body: message() })
    expect(res.status).toBe(401)
  })

  it('answers 502 without leaking the key when Anthropic is unreachable', async () => {
    const app = createApp(
      store,
      { mode: 'forward' },
      {
        ai: config(),
        fetch: () => Promise.reject(new TypeError(`fetch failed for ${SERVER_KEY}`)),
      },
    )
    const res = await post(app, message())
    expect(res.status).toBe(502)
    expect(await dump(res)).not.toContain(SERVER_KEY)
  })
})

describe('/api/config', () => {
  const get = (cfg: AiConfig, groups = 'romslig-users') =>
    appWith(cfg).request('/api/config', { headers: { 'Remote-User': 'kari', 'Remote-Groups': groups } })

  it('reports byok by default, with the user', async () => {
    const res = await get(aiConfigFromEnv({}))
    expect(await res.json()).toEqual({
      aiMode: 'byok',
      user: { id: 'kari', email: null, name: null, groups: ['romslig-users'] },
    })
  })

  it('reports server mode, and never the key', async () => {
    const res = await get(config())
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ aiMode: 'server' })
    expect(text).not.toContain(SERVER_KEY)
  })

  it('falls back to byok with a warning when the server key is missing', async () => {
    const warn = vi.fn()
    const cfg = aiConfigFromEnv({ AI_MODE: 'server' }, warn)
    expect(cfg.mode).toBe('byok')
    expect(warn).toHaveBeenCalledOnce()
    expect(await (await get(cfg)).json()).toMatchObject({ aiMode: 'byok' })
  })

  it('reports byok for users outside AI_GROUP', async () => {
    const cfg = config({ AI_GROUP: 'romslig-ai' })
    expect(await (await get(cfg)).json()).toMatchObject({ aiMode: 'byok' })
    expect(await (await get(cfg, 'romslig-ai')).json()).toMatchObject({ aiMode: 'server' })
  })

  it('needs login, while health does not mention AI', async () => {
    const app = appWith(config())
    expect((await app.request('/api/config')).status).toBe(401)
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true })
  })

  it('rejects unknown modes and bad limits', () => {
    expect(() => aiConfigFromEnv({ AI_MODE: 'other' })).toThrow(/AI_MODE/)
    expect(() => aiConfigFromEnv({ AI_RATE_PER_MIN: '0' })).toThrow(/AI_RATE_PER_MIN/)
  })
})

describe('RateLimiter', () => {
  it('frees up slots after a minute', () => {
    let now = 0
    const limiter = new RateLimiter(1, () => now)
    expect(limiter.take('a')).toBeNull()
    expect(limiter.take('a')).toBe(60)
    now = 30_000
    expect(limiter.take('a')).toBe(30)
    now = 60_000
    expect(limiter.take('a')).toBeNull()
  })
})
