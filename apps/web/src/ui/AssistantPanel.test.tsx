// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { emptyScenario, type AssistantEvent, type Note, type Project } from '@romslig/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAi, type AppConfig } from '../ai/client.ts'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { AssistantPanel, NotesList } from './AssistantPanel.tsx'

const ai = vi.hoisted(() => ({ runAssistant: vi.fn(), withAi: vi.fn() }))
vi.mock('@romslig/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@romslig/ai')>()),
  runAssistant: ai.runAssistant,
}))
vi.mock('../ai/client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/client.ts')>()),
  withAi: ai.withAi,
}))

function newProject(): Project {
  const scenario = emptyScenario()
  return {
    id: 'p_test',
    name: 'Test',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: false },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    chat: [],
    customFurniture: [],
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const state = () => useStore.getState()
const project = () => state().project!
const config = (aiMode: AppConfig['aiMode']): AppConfig => ({
  aiMode,
  user: { id: 'u', email: null, name: null, groups: [] },
})

/** A running assistant request: push events into it and finish it from the test. */
interface Run {
  emit(ev: AssistantEvent): void
  finish(): void
  fail(e: Error): void
  signal: AbortSignal
  request: { roomId: string | null; message: string }
}

function controlRuns() {
  const runs: Run[] = []
  ai.withAi.mockImplementation((action: (client: unknown) => Promise<unknown>) => action({}))
  ai.runAssistant.mockImplementation(
    (_client: unknown, request: Run['request'], onEvent: (ev: AssistantEvent) => void, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        runs.push({
          emit: (ev) => act(() => onEvent(ev)),
          finish: resolve,
          fail: reject,
          signal,
          request,
        })
      }),
  )
  return runs
}

const textbox = () => screen.getByRole('textbox')
const ask = (text: string) => {
  fireEvent.change(textbox(), { target: { value: text } })
  fireEvent.keyDown(textbox(), { key: 'Enter' })
}

function addRoom(name: string) {
  state().addRoom([
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ])
  const room = activeScenario(project()).rooms.at(-1)!
  state().updateRoom(room.id, { name })
  return room.id
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    state().load(newProject())
    resetHistory()
    sessionStorage.clear()
    useAi.setState({ config: config('server'), hasKey: false, keyDialogOpen: false })
    Element.prototype.scrollTo = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('cannot be used until the config has loaded', () => {
    useAi.setState({ config: null })
    render(<AssistantPanel />)

    expect(textbox()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Foreslå en god møblering av stua' })).toBeDisabled()
  })

  it('asks for a key first in byok mode, and keeps the question', () => {
    useAi.setState({ config: config('byok') })
    render(<AssistantPanel />)
    expect(textbox()).toHaveAttribute('placeholder', 'Legg inn Anthropic-nøkkelen (🔑 Nøkkel) for å spørre assistenten')

    fireEvent.click(screen.getByRole('button', { name: 'Hvordan kan vi få mer lagringsplass?' }))

    expect(useAi.getState().keyDialogOpen).toBe(true)
    expect(textbox()).toHaveValue('Hvordan kan vi få mer lagringsplass?')
    expect(ai.withAi).not.toHaveBeenCalled()

    useAi.setState({ keyDialogOpen: false })
    fireEvent.click(screen.getByRole('button', { name: 'Legg inn nøkkel' }))
    expect(useAi.getState().keyDialogOpen).toBe(true)
  })

  it('streams the answer, then stores the question, the answer, new variants and notes', async () => {
    const runs = controlRuns()
    const roomId = addRoom('Stue')
    render(<AssistantPanel />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Spør om' }), { target: { value: roomId } })

    // Shift+Enter is a new line, not a send
    fireEvent.change(textbox(), { target: { value: 'Åpent kjøkken?' } })
    fireEvent.keyDown(textbox(), { key: 'Enter', shiftKey: true })
    expect(ai.withAi).not.toHaveBeenCalled()
    fireEvent.keyDown(textbox(), { key: 'Enter' })

    await waitFor(() => expect(runs).toHaveLength(1))
    const run = runs[0]!
    expect(run.request).toMatchObject({ roomId, message: 'Åpent kjøkken?' })
    expect(textbox()).toHaveValue('')
    expect(screen.getByText('Tenker…')).toBeInTheDocument()

    run.emit({ type: 'thinking', delta: 'x'.repeat(300) })
    expect(screen.getByText(`…${'x'.repeat(280)}`)).toBeInTheDocument()
    run.emit({ type: 'activity', text: 'Lager variant «Åpent kjøkken»' })
    expect(screen.getByText('Lager variant «Åpent kjøkken»')).toBeInTheDocument()
    run.emit({ type: 'text', delta: 'Det går ' })
    run.emit({ type: 'text', delta: 'fint.' })
    expect(screen.getByText('Det går fint.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avbryt' })).toBeInTheDocument()

    const variant = { ...emptyScenario('Åpent kjøkken') }
    const note: Note = { id: 'n_1', roomId, text: 'Sjekk bærevegg.', author: 'ai', createdAt: '2026-01-01T00:00:00Z' }
    run.emit({ type: 'done', text: 'Se varianten.', scenarios: [variant], notes: [note] })
    run.finish()

    expect(await screen.findByText('Se varianten.')).toBeInTheDocument()
    expect(project().chat.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(screen.getByText('Stue', { selector: 'span' })).toHaveClass('msg-focus')
    expect(activeScenario(project()).notes).toEqual([note])

    fireEvent.click(screen.getByRole('button', { name: 'Vis «Åpent kjøkken»' }))
    expect(project().activeScenarioId).toBe(variant.id)
    expect(screen.getByRole('button', { name: '● «Åpent kjøkken»' })).toBeInTheDocument()
  })

  it('shows an error from the assistant, with a way to change the key in byok mode', async () => {
    useAi.setState({ config: config('byok'), hasKey: true })
    const runs = controlRuns()
    render(<AssistantPanel />)
    ask('Hei')
    await waitFor(() => expect(runs).toHaveLength(1))

    runs[0]!.emit({ type: 'error', message: 'Claude er overbelastet.' })
    runs[0]!.finish()

    expect(await screen.findByText(/Claude er overbelastet\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Endre nøkkel' }))
    expect(useAi.getState().keyDialogOpen).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Lukk' }))
    expect(screen.queryByText(/Claude er overbelastet\./)).not.toBeInTheDocument()
  })

  it('shows a failed request as an error', async () => {
    const runs = controlRuns()
    render(<AssistantPanel />)
    ask('Hei')
    await waitFor(() => expect(runs).toHaveLength(1))

    runs[0]!.fail(new Error('Fikk ikke kontakt med Claude.'))

    expect(await screen.findByText(/Fikk ikke kontakt med Claude\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Endre nøkkel' })).not.toBeInTheDocument()
  })

  it('puts the question back when the key dialog took over', async () => {
    ai.withAi.mockResolvedValue(null)
    render(<AssistantPanel />)
    ask('Hvor går vannet?')

    await waitFor(() => expect(textbox()).toHaveValue('Hvor går vannet?'))
    expect(project().chat).toHaveLength(0)
  })

  it('stops a running request on Avbryt and drops what it sends after', async () => {
    const runs = controlRuns()
    render(<AssistantPanel />)
    ask('Hei')
    await waitFor(() => expect(runs).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }))
    expect(runs[0]!.signal.aborted).toBe(true)
    runs[0]!.emit({ type: 'text', delta: 'for sent' })
    runs[0]!.fail(new Error('aborted'))

    await waitFor(() => expect(screen.queryByText('Hei')).not.toBeInTheDocument())
    expect(screen.queryByText('for sent')).not.toBeInTheDocument()
    expect(screen.queryByText('aborted')).not.toBeInTheDocument()
  })

  it('ends quietly when the request returns after an abort', async () => {
    const runs = controlRuns()
    const { unmount } = render(<AssistantPanel />)
    ask('Hei')
    await waitFor(() => expect(runs).toHaveLength(1))

    // Closing the panel stops the request
    unmount()
    expect(runs[0]!.signal.aborted).toBe(true)
    runs[0]!.finish()
  })

  it('renders the answer as a small, safe Markdown subset', () => {
    state().updateProject((p) => ({
      ...p,
      chat: [
        {
          id: 'm_1',
          role: 'assistant',
          text: '## Plan\nFørst **riv** veggen med `slegge`.\n- tak\n- gulv\n- tak\n1. male\n2) flise\n\n<b>ikke html</b>',
          createdAt: '2026-01-01T00:00:00Z',
          roomId: null,
          scenarioIds: ['sc_gone'],
        },
      ],
    }))
    render(<AssistantPanel />)

    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByText('riv').tagName).toBe('STRONG')
    expect(screen.getByText('slegge').tagName).toBe('CODE')
    const [bullets, numbered] = screen.getAllByRole('list')
    expect(
      within(bullets!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['tak', 'gulv', 'tak'])
    expect(
      within(numbered!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['male', 'flise'])
    expect(screen.getByText('<b>ikke html</b>')).toBeInTheDocument()
    // A variant that no longer exists gets no link
    expect(screen.queryByRole('button', { name: /«/ })).not.toBeInTheDocument()
  })
})

describe('NotesList', () => {
  beforeEach(() => {
    state().load(newProject())
    resetHistory()
  })

  it('shows nothing without notes', () => {
    render(<NotesList />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('lists the notes with their author and room, filters by room, and deletes one', () => {
    const roomId = addRoom('Bad')
    const scenarioId = project().activeScenarioId
    const notes: Note[] = [
      { id: 'n_1', roomId, text: 'Bytt sluk.', author: 'ai', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'n_2', roomId: null, text: 'Husk budsjett.', author: 'user', createdAt: '2026-01-01T00:00:00Z' },
    ]
    state().updateScenario((s) => ({ ...s, notes }))

    const { rerender } = render(<NotesList />)
    expect(screen.getByText('Assistent · Bad')).toBeInTheDocument()
    expect(screen.getByText('Deg')).toBeInTheDocument()

    rerender(<NotesList roomId={roomId} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Assistent')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    expect(
      project()
        .scenarios.find((s) => s.id === scenarioId)!
        .notes.map((n) => n.id),
    ).toEqual(['n_2'])
  })
})
