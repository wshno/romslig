import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, NetworkError } from './api.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=UTF-8' } })
const html = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

function answer(res: Response | (() => Promise<Response>)) {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
    typeof res === 'function' ? res() : Promise.resolve(res),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** The error a call ends in. Fails the test when the call succeeds. */
async function errorOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call
  } catch (e) {
    return e
  }
  throw new Error('the call did not fail')
}

afterEach(() => vi.unstubAllGlobals())

describe('requests to our API', () => {
  it('return the JSON of a success', async () => {
    answer(json([{ id: 'p_1', name: 'Kjøkken' }]))
    await expect(api.list()).resolves.toEqual([{ id: 'p_1', name: 'Kjøkken' }])
  })

  it('return nothing for 204', async () => {
    answer(new Response(null, { status: 204 }))
    await expect(api.remove('p_1')).resolves.toBeUndefined()
  })

  it('ask for JSON and do not follow redirects, and keep the headers of the call', async () => {
    const fetch = answer(json({ id: 'p_1', version: 4 }))
    await api.save({ id: 'p_1' } as Parameters<typeof api.save>[0], 3)
    const init = fetch.mock.calls[0]![1]
    const headers = new Headers(init.headers)
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('If-Match')).toBe('3')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init.redirect).toBe('manual')
    expect(init.method).toBe('PUT')
  })
})

describe('a refused request', () => {
  it('carries the message and status of our API', async () => {
    answer(json({ error: 'Prosjektet er endret et annet sted.' }, 409))
    const e = await errorOf(api.list())
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ status: 409, source: 'api', message: 'Prosjektet er endret et annet sted.' })
  })

  it('keeps a 401 from our API apart from an expired login', async () => {
    answer(json({ error: 'Ikke innlogget.' }, 401))
    expect(await errorOf(api.list())).toMatchObject({ status: 401, source: 'api', message: 'Ikke innlogget.' })
  })

  it('says the login has expired for a 401 from the login in front of the app', async () => {
    answer(html('<a href="https://auth.example/?rd=…">401 Unauthorized</a>', 401))
    const e = await errorOf(api.list())
    expect(e).toMatchObject({ status: 401, source: 'login' })
    expect((e as Error).message).toMatch(/Innloggingen er utløpt/)
  })

  it('says the login has expired for a redirect', async () => {
    // What fetch gives for a redirect with `redirect: 'manual'`
    answer({ ok: false, status: 0, type: 'opaqueredirect', headers: new Headers() } as Response)
    expect(await errorOf(api.list())).toMatchObject({ status: 401, source: 'login' })
  })

  it('says a firewall or gateway stopped a 403 that is not from our API', async () => {
    answer(html('<html><body>Request denied</body></html>', 403))
    const e = await errorOf(api.create('Kjøkken (Ås)', null))
    expect(e).toMatchObject({ status: 403, source: 'edge' })
    expect((e as Error).message).toMatch(/HTTP 403/)
    expect((e as Error).message).toMatch(/brannmur eller gateway/)
  })

  it('keeps a 403 from our API as it is', async () => {
    answer(json({ error: 'Ikke ditt prosjekt.' }, 403))
    expect(await errorOf(api.list())).toMatchObject({ status: 403, source: 'api', message: 'Ikke ditt prosjekt.' })
  })

  it('says the app does not answer when the gateway has nothing behind it', async () => {
    answer(new Response('Bad Gateway', { status: 502 }))
    const e = await errorOf(api.list())
    expect(e).toMatchObject({ status: 502, source: 'edge' })
    expect((e as Error).message).toMatch(/svarer ikke akkurat nå \(HTTP 502\)/)
  })

  it('names an upload that is too big for what is in front of the app', async () => {
    answer(html('<h1>413 Request Entity Too Large</h1>', 413))
    expect(await errorOf(api.list())).toMatchObject({ status: 413, source: 'edge' })
  })

  it('does not take JSON without an error text for an answer from our API', async () => {
    answer(json({ message: 'no healthy upstream' }, 503))
    expect(await errorOf(api.list())).toMatchObject({ status: 503, source: 'edge' })
  })

  it('does not take a page answered with 200 for data', async () => {
    answer(html('<!doctype html><title>Sign in</title>', 200))
    const e = await errorOf(api.list())
    expect(e).toMatchObject({ status: 200, source: 'edge' })
    expect((e as Error).message).toMatch(/HTTP 200/)
  })
})

describe('a request without an answer', () => {
  it('is a NetworkError without a status, so that it can be told from a refusal', async () => {
    answer(() => Promise.reject(new TypeError('Failed to fetch')))
    const e = await errorOf(api.list())
    expect(e).toBeInstanceOf(NetworkError)
    expect(e).not.toHaveProperty('status')
    expect((e as Error).message).toMatch(/Får ikke kontakt/)
  })

  it('passes an abort on as it is', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    answer(() => Promise.reject(abort))
    expect(await errorOf(api.list())).toBe(abort)
  })
})
