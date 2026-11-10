import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { User } from '../auth.ts'
import { jsonLog, type Log, type LogLine } from '../log.ts'
import { aiModeFor, type AiConfig } from './config.ts'

type Env = { Variables: { user: User; requestId: string } }

/** Largest request body the proxy accepts (images are base64 in the JSON). */
export const MAX_BODY_BYTES = 20 * 1024 * 1024

/** Request headers passed on to Anthropic. Everything else (x-api-key, authorization, the
 * browser-access header, cookies, the SDK's x-stainless-* headers) is dropped. */
const FORWARDED_REQUEST_HEADERS = ['anthropic-version', 'anthropic-beta']
/** Response headers passed back to the browser. */
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'request-id', 'retry-after', 'x-should-retry']

type ErrorType = 'invalid_request_error' | 'not_found_error' | 'request_too_large' | 'rate_limit_error' | 'api_error'

/** An error in Anthropic's format, so the browser SDK raises the matching error class. */
function anthropicError(c: Context, status: 400 | 404 | 413 | 429 | 502, type: ErrorType, message: string) {
  return c.json({ type: 'error', error: { type, message } }, status)
}

/** Sliding one-minute window of request times per user, in memory (one replica). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly perMinute: number,
    private readonly now = () => Date.now(),
  ) {}

  /** Records a request; returns the seconds to wait if the user is over the limit. */
  take(key: string): number | null {
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < 60_000)
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent)
      return Math.max(1, Math.ceil((recent[0]! + 60_000 - t) / 1000))
    }
    recent.push(t)
    this.hits.set(key, recent)
    // Forget idle users now and then so the map does not grow without bound
    if (this.hits.size > 1000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < 60_000)) this.hits.delete(k)
    return null
  }
}

/** Only what is safe to log: the model name as sent, without control characters. */
const logSafe = (v: unknown) =>
  String(v)
    .replace(/[^\w.:-]/g, '?')
    .slice(0, 64)

/**
 * Passes the response through unchanged while noting the token counts from `usage` (in the JSON
 * body or the SSE events), and logs one line when it ends. Never logs content.
 */
function withUsageLog(body: ReadableStream<Uint8Array>, log: (usage: Omit<LogLine, 'msg' | 'level'>) => void) {
  const decoder = new TextDecoder()
  let tail = ''
  let input = 0
  let output = 0
  let logged = false
  const done = (aborted: boolean) => {
    if (logged) return
    logged = true
    log({ input_tokens: input, output_tokens: output, ...(aborted ? { aborted } : {}) })
  }
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk)
        const text = tail + decoder.decode(chunk, { stream: true })
        for (const m of text.matchAll(/"input_tokens":\s*(\d+)/g)) input = Math.max(input, Number(m[1]))
        for (const m of text.matchAll(/"output_tokens":\s*(\d+)/g)) output = Math.max(output, Number(m[1]))
        tail = text.slice(-64)
      },
      flush: () => done(false),
      cancel: () => done(true),
    }),
  )
}

/**
 * POST /ai/v1/messages: a passthrough to Anthropic's Messages API that adds the server's key, for
 * users whose effective AI mode is "server". The browser SDK points its baseURL here. In byok mode
 * (or for users outside AI_GROUP) the route does not exist (404).
 */
export function aiProxy(
  cfg: AiConfig,
  fetchImpl: typeof fetch = fetch,
  limiter = new RateLimiter(cfg.ratePerMin),
  write: Log = jsonLog,
) {
  const app = new Hono<Env>()
  /** One line per AI request, with the id of the request line it belongs to. */
  const note = (c: Context<Env>, model: unknown, status: number, extra: Omit<LogLine, 'msg' | 'level'> = {}) =>
    write({
      msg: 'ai',
      id: c.get('requestId'),
      user: logSafe(c.get('user').id),
      model: logSafe(model),
      status,
      ...extra,
    })

  app.post(
    '/v1/messages',
    async (c, next) => {
      if (aiModeFor(cfg, c.get('user')) !== 'server' || !cfg.apiKey) return c.notFound()
      await next()
    },
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => {
        note(c, '-', 413)
        return anthropicError(c, 413, 'request_too_large', 'Forespørselen er for stor (maks 20 MB).')
      },
    }),
    async (c) => {
      const user = c.get('user')
      const log = (model: unknown, status: number, extra?: Omit<LogLine, 'msg' | 'level'>) =>
        note(c, model, status, extra)
      const raw = await c.req.text()
      let body: { model?: unknown; max_tokens?: unknown }
      try {
        body = JSON.parse(raw) as typeof body
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('not an object')
      } catch {
        log('-', 400)
        return anthropicError(c, 400, 'invalid_request_error', 'Forespørselen er ikke gyldig JSON.')
      }
      const { model, max_tokens: maxTokens } = body
      if (typeof model !== 'string' || !cfg.models.includes(model)) {
        log(model, 400)
        return anthropicError(
          c,
          400,
          'invalid_request_error',
          `Modellen er ikke tillatt her. Tillatt: ${cfg.models.join(', ')}.`,
        )
      }
      if (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > cfg.maxTokens) {
        log(model, 400)
        return anthropicError(
          c,
          400,
          'invalid_request_error',
          `max_tokens må være et heltall fra 1 til ${cfg.maxTokens}.`,
        )
      }
      const wait = limiter.take(user.id)
      if (wait !== null) {
        log(model, 429)
        c.header('retry-after', String(wait))
        // The browser SDK would otherwise retry at once and count against the limit again
        c.header('x-should-retry', 'false')
        return anthropicError(c, 429, 'rate_limit_error', 'For mange AI-forespørsler. Vent litt og prøv igjen.')
      }

      const headers = new Headers({ 'content-type': 'application/json', 'x-api-key': cfg.apiKey! })
      for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = c.req.header(name)
        if (value) headers.set(name, value)
      }
      let upstream: Response
      try {
        upstream = await fetchImpl(`${cfg.baseUrl}/v1/messages`, {
          method: 'POST',
          headers,
          body: raw,
          signal: c.req.raw.signal,
        })
      } catch (e) {
        if (c.req.raw.signal.aborted) {
          // The browser went away; nobody reads this response
          log(model, 499, { aborted: true })
          return new Response(null, { status: 499 })
        }
        log(model, 502, { error: logSafe((e as Error).name) })
        return anthropicError(c, 502, 'api_error', 'Fikk ikke kontakt med Anthropic.')
      }

      const out = new Headers()
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name)
        if (value) out.set(name, value)
      }
      out.set('cache-control', 'no-store')
      if (!upstream.body) {
        log(model, upstream.status)
        return new Response(null, { status: upstream.status, headers: out })
      }
      const stream = withUsageLog(upstream.body, (usage) => log(model, upstream.status, usage))
      return new Response(stream, { status: upstream.status, headers: out })
    },
  )
  return app
}
