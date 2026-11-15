// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AiError } from '@romslig/ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAi, type AppConfig } from '../ai/client.ts'
import { ApiKeyButton, ApiKeyDialog } from './ApiKeyDialog.tsx'

const listModels = vi.hoisted(() => vi.fn<() => Promise<unknown>>())
vi.mock('../ai/client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/client.ts')>()),
  byokClient: () => ({ models: { list: listModels } }),
}))

const config = (aiMode: AppConfig['aiMode']): AppConfig => ({
  aiMode,
  user: { id: 'u', email: null, name: null, groups: [] },
})

const keyField = () => screen.getByLabelText('Anthropic API-nøkkel')
const saveButton = () => screen.getByRole('button', { name: 'Lagre og test' })

function typeKey(key: string) {
  fireEvent.change(keyField(), { target: { value: key } })
}

describe('ApiKeyDialog', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAi.setState({ hasKey: false, keyDialogOpen: true, config: config('byok') })
    listModels.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tests a working key, stores it for the tab and says so', async () => {
    listModels.mockResolvedValue({ data: [] })
    render(<ApiKeyDialog />)
    expect(saveButton()).toBeDisabled()

    typeKey('  sk-ant-good  ')
    fireEvent.click(saveButton())

    expect(await screen.findByText('✓ Nøkkelen fungerer.')).toBeInTheDocument()
    expect(sessionStorage.getItem('romslig.anthropicKey')).toBe('sk-ant-good')
    expect(useAi.getState().hasKey).toBe(true)
    expect(keyField()).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Ferdig' })).toBeInTheDocument()
  })

  it('keeps a rejected key out of storage and shows why', async () => {
    listModels.mockRejectedValue(new AiError('Anthropic-nøkkelen ble avvist.', 'auth'))
    render(<ApiKeyDialog />)

    typeKey('sk-ant-bad')
    fireEvent.click(saveButton())

    expect(await screen.findByText('Anthropic-nøkkelen ble avvist.')).toBeInTheDocument()
    expect(sessionStorage.getItem('romslig.anthropicKey')).toBeNull()
    expect(keyField()).toHaveValue('sk-ant-bad')

    // Typing again clears the message
    typeKey('sk-ant-bad2')
    expect(screen.queryByText('Anthropic-nøkkelen ble avvist.')).not.toBeInTheDocument()
  })

  it('keeps a key it could not test, and says it was not tested', async () => {
    listModels.mockRejectedValue(new AiError('Fikk ikke kontakt med Claude.', 'network'))
    render(<ApiKeyDialog />)

    typeKey('sk-ant-maybe')
    fireEvent.click(saveButton())

    expect(
      await screen.findByText('Nøkkelen er lagret, men kunne ikke testes: Fikk ikke kontakt med Claude.'),
    ).toBeInTheDocument()
    expect(sessionStorage.getItem('romslig.anthropicKey')).toBe('sk-ant-maybe')
  })

  it('says so when the browser refuses to store the key', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    listModels.mockResolvedValue({ data: [] })
    const { unmount } = render(<ApiKeyDialog />)

    typeKey('sk-ant-good')
    fireEvent.click(saveButton())
    expect(await screen.findByText('Nettleseren tillot ikke å lagre nøkkelen i økten.')).toBeInTheDocument()
    unmount()

    // Also when the key could not be tested
    listModels.mockRejectedValue(new Error('offline'))
    render(<ApiKeyDialog />)
    typeKey('sk-ant-good')
    fireEvent.click(saveButton())
    expect(await screen.findByText('Nettleseren tillot ikke å lagre nøkkelen i økten.')).toBeInTheDocument()
  })

  it('forgets a stored key', () => {
    sessionStorage.setItem('romslig.anthropicKey', 'sk-ant-old')
    useAi.setState({ hasKey: true })
    render(<ApiKeyDialog />)
    expect(keyField()).toHaveAttribute('placeholder', 'En nøkkel er lagt inn. Lim inn en ny for å bytte.')

    fireEvent.click(screen.getByRole('button', { name: 'Glem nøkkelen' }))

    expect(sessionStorage.getItem('romslig.anthropicKey')).toBeNull()
    expect(screen.getByRole('button', { name: 'Glem nøkkelen' })).toBeDisabled()
  })

  it('closes on Escape, on the backdrop and on Lukk, but not on a click inside', () => {
    render(<ApiKeyDialog />)

    fireEvent.click(screen.getByRole('dialog'))
    expect(useAi.getState().keyDialogOpen).toBe(true)

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(useAi.getState().keyDialogOpen).toBe(false)

    useAi.setState({ keyDialogOpen: true })
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(useAi.getState().keyDialogOpen).toBe(false)

    useAi.setState({ keyDialogOpen: true })
    fireEvent.click(screen.getByRole('button', { name: 'Lukk' }))
    expect(useAi.getState().keyDialogOpen).toBe(false)
  })
})

describe('ApiKeyButton', () => {
  it('shows only in byok mode, with whether a key is set, and opens the dialog', () => {
    useAi.setState({ config: config('server'), hasKey: false, keyDialogOpen: false })
    const { rerender } = render(<ApiKeyButton />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    act(() => useAi.setState({ config: config('byok') }))
    rerender(<ApiKeyButton />)
    expect(screen.getByRole('button', { name: '🔑 Nøkkel' })).toHaveAttribute(
      'title',
      'Legg inn Anthropic-nøkkel for AI',
    )

    act(() => useAi.setState({ hasKey: true }))
    fireEvent.click(screen.getByRole('button', { name: '🔑 Nøkkel ✓' }))
    expect(useAi.getState().keyDialogOpen).toBe(true)
  })
})
