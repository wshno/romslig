// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ClientModule = typeof import('./client.ts')

const config = (aiMode: 'byok' | 'server') =>
  Response.json({ aiMode, user: { id: 'u', email: null, name: null, groups: [] } })

/** The module keeps its config and its first read of the key, so each test loads it afresh. */
async function load(answer?: () => Promise<Response>): Promise<ClientModule> {
  vi.resetModules()
  if (answer) vi.stubGlobal('fetch', vi.fn(answer))
  return import('./client.ts')
}

describe('the AI client', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads a key already stored for the tab', async () => {
    sessionStorage.setItem('romslig.anthropicKey', 'sk-ant-x')
    const { useAi } = await load()
    expect(useAi.getState().hasKey).toBe(true)
  })

  it('stores and forgets the key in the session only', async () => {
    const { useAi } = await load()

    expect(useAi.getState().setKey('sk-ant-y')).toBe(true)
    expect(sessionStorage.getItem('romslig.anthropicKey')).toBe('sk-ant-y')
    expect(localStorage).toHaveLength(0)
    expect(useAi.getState().hasKey).toBe(true)

    useAi.getState().forgetKey()
    expect(sessionStorage.getItem('romslig.anthropicKey')).toBeNull()
    expect(useAi.getState().hasKey).toBe(false)
  })

  it('reports a key the browser refuses to store, and forgets without a store', async () => {
    const { useAi } = await load()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(useAi.getState().setKey('sk-ant-z')).toBe(false)
    expect(useAi.getState().hasKey).toBe(false)
    useAi.getState().forgetKey()
    expect(useAi.getState().hasKey).toBe(false)
  })

  it('has no key when the session storage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const { useAi } = await load()
    expect(useAi.getState().hasKey).toBe(false)
  })

  it('opens and closes the key dialog', async () => {
    const { useAi } = await load()
    useAi.getState().openKeyDialog()
    expect(useAi.getState().keyDialogOpen).toBe(true)
    useAi.getState().closeKeyDialog()
    expect(useAi.getState().keyDialogOpen).toBe(false)
  })

  it('loads the config once, and again after a failure', async () => {
    let calls = 0
    const { loadConfig, useAi } = await load(() =>
      Promise.resolve(++calls === 1 ? new Response('', { status: 503 }) : config('server')),
    )

    await expect(loadConfig()).rejects.toThrow('Kunne ikke hente oppsettet (503).')
    await expect(loadConfig()).resolves.toMatchObject({ aiMode: 'server' })
    await loadConfig()
    expect(calls).toBe(2)
    expect(useAi.getState().config?.aiMode).toBe('server')
  })

  it('says AI is available in server mode, and in byok mode once a key is set', async () => {
    const { useAi, useAiAvailable } = await load()
    const { result, rerender } = renderHook(() => useAiAvailable())
    expect(result.current).toBeNull()

    useAi.setState({ config: { aiMode: 'byok', user: { id: 'u', email: null, name: null, groups: [] } } })
    rerender()
    expect(result.current).toBe(false)

    useAi.setState({ hasKey: true })
    rerender()
    expect(result.current).toBe(true)

    useAi.setState({
      hasKey: false,
      config: { aiMode: 'server', user: { id: 'u', email: null, name: null, groups: [] } },
    })
    rerender()
    expect(result.current).toBe(true)
  })

  it('goes through our proxy in server mode', async () => {
    const { getClient } = await load(() => Promise.resolve(config('server')))
    const client = await getClient()
    expect(client.baseURL).toBe(`${location.origin}/api/ai`)
    expect(client.apiKey).toBe('server-proxy')
  })

  it('goes straight to Anthropic with the key in byok mode', async () => {
    sessionStorage.setItem('romslig.anthropicKey', 'sk-ant-k')
    const { getClient, byokClient } = await load(() => Promise.resolve(config('byok')))
    const client = await getClient()
    expect(client.apiKey).toBe('sk-ant-k')
    expect(byokClient('sk-ant-other').apiKey).toBe('sk-ant-other')
  })

  it('opens the key dialog instead of failing when byok has no key', async () => {
    const { withAi, useAi, MissingKeyError, getClient } = await load(() => Promise.resolve(config('byok')))

    await expect(getClient()).rejects.toBeInstanceOf(MissingKeyError)
    const action = vi.fn()
    await expect(withAi(action)).resolves.toBeNull()
    expect(action).not.toHaveBeenCalled()
    expect(useAi.getState().keyDialogOpen).toBe(true)
  })

  it('passes on a config failure', async () => {
    const { withAi } = await load(() => Promise.resolve(new Response('', { status: 500 })))
    await expect(withAi(vi.fn())).rejects.toThrow('Kunne ikke hente oppsettet (500).')
  })

  it('returns what the action gives', async () => {
    const { withAi } = await load(() => Promise.resolve(config('server')))
    await expect(withAi(() => Promise.resolve(42))).resolves.toBe(42)
  })

  it('opens the key dialog when Anthropic rejects the key in byok mode', async () => {
    sessionStorage.setItem('romslig.anthropicKey', 'sk-ant-bad')
    const { withAi, useAi } = await load(() => Promise.resolve(config('byok')))
    // The same module instance the client just loaded
    const { AiError } = await import('@romslig/ai')

    await expect(withAi(() => Promise.reject(new AiError('avvist', 'auth')))).rejects.toThrow('avvist')
    expect(useAi.getState().keyDialogOpen).toBe(true)
  })

  it('leaves the dialog shut for other errors, and for auth errors in server mode', async () => {
    const { withAi, useAi } = await load(() => Promise.resolve(config('server')))
    const { AiError } = await import('@romslig/ai')

    await expect(withAi(() => Promise.reject(new AiError('avvist', 'auth')))).rejects.toThrow('avvist')
    await expect(withAi(() => Promise.reject(new Error('boom')))).rejects.toThrow()
    expect(useAi.getState().keyDialogOpen).toBe(false)
  })
})
