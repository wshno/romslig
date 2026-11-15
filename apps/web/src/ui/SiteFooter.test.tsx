// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const config = (version: string | null, sha: string | null) =>
  Response.json({ aiMode: 'server', user: { id: 'u', email: null, name: null, groups: [] }, build: { version, sha } })

// The module keeps the config it loaded, so each test gets fresh modules.
async function renderFooter(answer: () => Promise<Response>, web: { version?: string; sha?: string } = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_APP_VERSION', web.version ?? '')
  vi.stubEnv('VITE_GIT_SHA', web.sha ?? '')
  vi.stubGlobal('fetch', vi.fn(answer))
  const { SiteFooter } = await import('./SiteFooter.tsx')
  render(<SiteFooter />)
}

describe('SiteFooter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('shows both versions, and dev for a local web build', async () => {
    await renderFooter(() => Promise.resolve(config('0.4.0', '1a2b3c4d5e')))

    expect(screen.getByText('web dev')).toBeInTheDocument()
    expect(await screen.findByText('api 0.4.0 · 1a2b3c4')).toHaveAttribute('title', '1a2b3c4d5e')
  })

  it('warns when the web and the api versions differ', async () => {
    await renderFooter(() => Promise.resolve(config('0.4.0', null)), { version: '0.3.0', sha: 'abcdef0123' })

    expect(screen.getByText('web 0.3.0 · abcdef0')).toHaveAttribute('title', 'abcdef0123')
    expect(await screen.findByText(/ulik versjon/)).toHaveClass('mismatch')
  })

  it('says the api is unavailable when the config cannot be loaded', async () => {
    await renderFooter(() => Promise.resolve(new Response('', { status: 502 })))

    expect(screen.getByText('api …')).toBeInTheDocument()
    expect(await screen.findByText('api utilgjengelig')).toBeInTheDocument()
  })
})
