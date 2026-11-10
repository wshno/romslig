import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { routePath } from 'hono/route'
import type { User } from './auth.ts'

/**
 * One log line: what happened (`msg`) and plain values about it. Never what a request or a
 * project contains.
 */
export type LogLine = { msg: string; level?: 'info' | 'warn' | 'error' } & Record<
  string,
  string | number | boolean | null
>
export type Log = (line: LogLine) => void

/** One JSON object per line, which is what the cluster's log collector parses. */
export const jsonLog: Log = (line) => {
  const text = JSON.stringify({ time: new Date().toISOString(), level: 'info', ...line })
  if (line.level === 'error' || line.level === 'warn') console.error(text)
  else console.log(text)
}

/** An id from the gateway is kept, so its log and ours can be read together. Anything else is replaced. */
const USABLE_ID = /^[\w.-]{8,64}$/

/**
 * Gives every request an id (also sent back as X-Request-Id) and logs one line when it is
 * answered: method, route, status, time taken and user. A streamed answer is logged when it
 * starts. The probes' successful health checks are left out; they come every few seconds.
 */
export function requestLog(log: Log): MiddlewareHandler<{ Variables: { requestId: string; user?: User } }> {
  return async (c, next) => {
    const given = c.req.header('X-Request-Id')
    const id = given && USABLE_ID.test(given) ? given : randomUUID()
    c.set('requestId', id)
    const start = performance.now()
    await next()
    // Set on the finished response: headers set before a handler returns a Response of its own are lost
    c.header('X-Request-Id', id)
    const status = c.res.status
    // The route of the last handler that ran: the endpoint, or the middleware that refused
    const route = routePath(c)
    if ((route === '/api/health' || route === '/api/health/ready') && status === 200) return
    log({
      level: status >= 500 ? 'error' : 'info',
      msg: 'request',
      id,
      method: c.req.method,
      route,
      path: c.req.path,
      status,
      ms: Math.round(performance.now() - start),
      user: c.get('user')?.id ?? null,
    })
  }
}
