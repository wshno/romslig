// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { emptyScenario, type Project } from '@romslig/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAi } from '../ai/client.ts'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { COMPACT_QUERY, NARROW_QUERY } from '../device.ts'
import { stubMatchMedia } from '../test/matchMedia.ts'
import { Editor } from './Editor.tsx'

// Konva and three.js can't draw in jsdom, and the panels have tests of their own.
vi.mock('../editor2d/Plan2D.tsx', () => ({ Plan2D: () => <div>2D-plan</div> }))
vi.mock('../viewer3d/Viewer3D.tsx', () => ({ Viewer3D: () => <div>3D-visning</div> }))
vi.mock('./CompareView.tsx', () => ({ CompareView: () => <div>Sammenligning</div> }))
vi.mock('./Inspector.tsx', () => ({ Inspector: () => <aside>Inspektør</aside> }))

function newProject(over: Partial<Project> = {}): Project {
  const scenario = emptyScenario()
  return {
    id: 'p_ed',
    name: 'Leiligheten',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: false },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    chat: [],
    customFurniture: [],
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fake API: the stored project, and what the next saves answer (a status, or the default success). */
function stubServer(stored: Project) {
  const server = {
    stored,
    saves: [] as { version: string | null; body: Project }[],
    answers: [] as number[],
    getFails: false,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      if (url === '/api/config')
        return Promise.resolve(json({ aiMode: 'server', user: { id: 'u', email: null, name: null, groups: [] } }))
      if (method === 'GET' && url === `/api/projects/${stored.id}`)
        return Promise.resolve(server.getFails ? json({ error: 'Fant ikke prosjektet.' }, 404) : json(server.stored))
      if (method === 'PUT') {
        const body = JSON.parse(init.body as string) as Project
        server.saves.push({ version: new Headers(init.headers).get('If-Match'), body })
        const status = server.answers.shift() ?? 200
        if (status === 409) return Promise.resolve(json({ error: 'Lagret et annet sted.' }, 409))
        if (status !== 200) return Promise.resolve(json({ error: `Feil ${status}.` }, status))
        server.stored = { ...body, version: server.stored.version + 1 }
        return Promise.resolve(json(server.stored))
      }
      return Promise.resolve(json({ error: `no route ${method} ${url}` }, 404))
    }),
  )
  return server
}

const state = () => useStore.getState()
const scenario = () => activeScenario(state().project!)
const nameField = () => screen.getByDisplayValue(state().project!.name)
const key = (k: string, opts: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    fireEvent.keyDown(document.body, { key: k, ...opts })
  })

/** Saves now: a hidden tab does not wait for the quiet moment. */
function hideTab() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
}

async function openEditor(project = newProject()) {
  const server = stubServer(project)
  const view = render(<Editor projectId={project.id} />)
  await screen.findByDisplayValue(project.name)
  return { server, ...view }
}

describe('Editor', () => {
  beforeEach(() => {
    useStore.setState({ project: null, view: 'split', focus: false, tool: 'select' })
    resetHistory()
    useAi.setState({ keyDialogOpen: false })
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads the project and shows the plan, the 3D view, the tools and the inspector', async () => {
    stubServer(newProject())
    render(<Editor projectId="p_ed" />)
    expect(screen.getByText('Laster prosjekt…')).toBeInTheDocument()

    expect(await screen.findByDisplayValue('Leiligheten')).toBeInTheDocument()
    expect(screen.getByText('2D-plan')).toBeInTheDocument()
    expect(screen.getByText('3D-visning')).toBeInTheDocument()
    expect(screen.getByText('Inspektør')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Lagret')
  })

  it('says why the project could not be loaded', async () => {
    const server = stubServer(newProject())
    server.getFails = true
    render(<Editor projectId="p_ed" />)

    expect(await screen.findByText('Fant ikke prosjektet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Tilbake' })).toHaveAttribute('href', '#/')
  })

  it('saves a change with the version it was loaded at', async () => {
    const { server } = await openEditor()

    fireEvent.change(nameField(), { target: { value: 'Hytta' } })
    hideTab()

    await waitFor(() => expect(server.saves).toHaveLength(1))
    expect(server.saves[0]).toMatchObject({ version: '1', body: { name: 'Hytta' } })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Lagret'))
  })

  it('shows a save the server refused, and tries again on a click', async () => {
    const { server } = await openEditor()
    server.answers.push(400)

    fireEvent.change(nameField(), { target: { value: 'Hytta' } })
    hideTab()

    const retry = await screen.findByRole('button', { name: 'Ikke lagret – prøv igjen' })
    expect(retry).toHaveAttribute('title', 'Feil 400.')
    // The message also shows as a toast, which a click dismisses
    fireEvent.click(screen.getByText('Feil 400.', { selector: '.toast' }))
    expect(screen.queryByText('Feil 400.', { selector: '.toast' })).not.toBeInTheDocument()

    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Lagret'))
    expect(server.saves).toHaveLength(2)
  })

  it('on a conflict, loads the newest version when asked', async () => {
    const { server } = await openEditor()
    server.answers.push(409)

    fireEvent.change(nameField(), { target: { value: 'Mitt navn' } })
    hideTab()

    expect(await screen.findByRole('alertdialog', { name: 'Endret på en annen enhet' })).toBeInTheDocument()
    server.stored = { ...server.stored, name: 'Deres navn', version: 5 }
    fireEvent.click(screen.getByRole('button', { name: 'Last inn siste versjon' }))

    expect(await screen.findByDisplayValue('Deres navn')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('on a conflict, saves over the other copy when asked to keep mine', async () => {
    const { server } = await openEditor()
    server.answers.push(409)

    fireEvent.change(nameField(), { target: { value: 'Mitt navn' } })
    hideTab()
    await screen.findByRole('alertdialog')
    server.stored = { ...server.stored, version: 7 }

    fireEvent.click(screen.getByRole('button', { name: 'Behold mine endringer' }))

    await waitFor(() => expect(server.saves).toHaveLength(2))
    expect(server.saves[1]).toMatchObject({ version: '7', body: { name: 'Mitt navn' } })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('asks before the tab closes with changes not saved yet', async () => {
    await openEditor()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fireEvent.change(nameField(), { target: { value: 'Hytta' } })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('saves what is left when closed, and waits for that save when opened again', async () => {
    const { server, unmount } = await openEditor()
    fireEvent.change(nameField(), { target: { value: 'Siste navn' } })

    unmount()
    render(<Editor projectId="p_ed" />)

    expect(await screen.findByDisplayValue('Siste navn')).toBeInTheDocument()
    expect(server.saves.map((s) => s.body.name)).toEqual(['Siste navn'])
  })

  it('switches views, and hides the tools and the inspector in focus mode', async () => {
    await openEditor()

    fireEvent.click(screen.getByRole('button', { name: '2D' }))
    expect(screen.queryByText('3D-visning')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '3D' }))
    expect(screen.queryByText('2D-plan')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sammenlign' }))
    expect(screen.getByText('Sammenligning')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fokus' }))
    expect(screen.queryByText('Inspektør')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Vegg/ })).not.toBeInTheDocument()
    // Tool keys do nothing in focus mode
    key('w')
    expect(state().tool).toBe('select')
    fireEvent.click(screen.getByRole('button', { name: 'Vis paneler' }))
    expect(screen.getByText('Inspektør')).toBeInTheDocument()
  })

  it('opens the print page', async () => {
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Skriv ut' }))
    expect(window.location.hash).toBe('#/p/p_ed/print')
  })

  it('makes, renames and deletes variants after asking', async () => {
    await openEditor()
    const prompt = vi.fn<(message: string, value?: string) => string | null>()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('confirm', confirm)
    expect(screen.getByTitle('Slett variant')).toBeDisabled()

    prompt.mockReturnValueOnce(null)
    fireEvent.click(screen.getByTitle('Ny variant (kopi av denne)'))
    expect(state().project!.scenarios).toHaveLength(1)

    prompt.mockReturnValueOnce('Åpent kjøkken')
    fireEvent.click(screen.getByTitle('Ny variant (kopi av denne)'))
    expect(prompt).toHaveBeenLastCalledWith('Navn på ny variant', 'Eksisterende (kopi)')
    expect(state().project!.scenarios).toHaveLength(2)
    expect(scenario().name).toBe('Åpent kjøkken')

    prompt.mockReturnValueOnce('Kjøkken mot stua')
    fireEvent.click(screen.getByTitle('Gi nytt navn'))
    expect(scenario().name).toBe('Kjøkken mot stua')
    prompt.mockReturnValueOnce('')
    fireEvent.click(screen.getByTitle('Gi nytt navn'))
    expect(scenario().name).toBe('Kjøkken mot stua')

    const first = state().project!.scenarios[0]!.id
    fireEvent.change(screen.getByRole('combobox'), { target: { value: first } })
    expect(state().project!.activeScenarioId).toBe(first)

    fireEvent.click(screen.getByTitle('Slett variant'))
    expect(confirm).toHaveBeenCalledWith('Slette varianten «Eksisterende»?')
    expect(state().project!.scenarios.map((s) => s.name)).toEqual(['Kjøkken mot stua'])
  })

  it('undoes and redoes with the buttons and the keyboard', async () => {
    await openEditor()
    const undo = screen.getByTitle('Angre (Ctrl+Z)')
    expect(undo).toBeDisabled()

    act(() => state().addWall({ x: 0, y: 0 }, { x: 3, y: 0 }))
    fireEvent.click(undo)
    expect(scenario().walls).toHaveLength(0)
    fireEvent.click(screen.getByTitle('Gjør om (Ctrl+Y)'))
    expect(scenario().walls).toHaveLength(1)

    key('z', { ctrlKey: true })
    expect(scenario().walls).toHaveLength(0)
    key('z', { ctrlKey: true, shiftKey: true })
    expect(scenario().walls).toHaveLength(1)
    key('z', { metaKey: true })
    key('y', { ctrlKey: true })
    expect(scenario().walls).toHaveLength(1)
  })

  it('picks tools by key, but not while typing in a field', async () => {
    await openEditor()

    key('w')
    expect(state().tool).toBe('wall')
    key('R')
    expect(state().tool).toBe('room')
    key('x')
    expect(state().tool).toBe('room')
    key('Escape')
    expect(state().tool).toBe('select')

    fireEvent.keyDown(nameField(), { key: 'w' })
    expect(state().tool).toBe('select')

    // In 3D walk mode the pointer is locked: keys don't pick tools
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: document.body })
    key('w')
    expect(state().tool).toBe('select')
  })

  it('deletes, duplicates and turns the selection from the keyboard', async () => {
    await openEditor()
    act(() => state().addFurniture('sofa-3', { x: 2, y: 2 }, { snap: false }))
    const id = scenario().furniture[0]!.id
    act(() => state().select({ kind: 'furniture', id }))

    key('e')
    expect(scenario().furniture[0]!.rotation).toBe(90)
    key('Q', { shiftKey: true })
    expect(scenario().furniture[0]!.rotation).toBe(75)

    key('d', { ctrlKey: true })
    expect(scenario().furniture).toHaveLength(2)

    key('Delete')
    expect(scenario().furniture).toHaveLength(1)
    act(() => state().select({ kind: 'furniture', id }))
    key('Backspace')
    expect(scenario().furniture).toHaveLength(0)

    // Without furniture selected, q and e are not turns (and pick no tool)
    key('e')
    expect(state().tool).toBe('select')
  })

  it('shows the settings of the wall, fixture and run tools', async () => {
    await openEditor()

    fireEvent.click(screen.getByRole('button', { name: /Vegg/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Tykkelse' }), { target: { value: '0.2' } })
    expect(state().wallThickness).toBeCloseTo(0.2)

    fireEvent.click(screen.getByRole('button', { name: /Punkt/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'switch' } })
    expect(state().fixtureKind).toBe('switch')

    fireEvent.click(screen.getByRole('button', { name: /Føring/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'drain' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Ligger' }), { target: { value: 'floor' } })
    expect(state()).toMatchObject({ runKind: 'drain', runPlacement: 'floor' })
  })

  it('shows the key dialog when it is open', async () => {
    await openEditor()
    act(() => useAi.setState({ keyDialogOpen: true }))
    expect(screen.getByRole('dialog', { name: '🔑 Anthropic-nøkkel' })).toBeInTheDocument()
  })

  it('keeps the desktop layout where matchMedia says the window is wide', async () => {
    stubMatchMedia({ [NARROW_QUERY]: false })
    await openEditor()
    expect(screen.getByRole('button', { name: '2D + 3D' })).toHaveClass('active')
    expect(screen.queryByRole('button', { name: 'Flere valg' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Egenskaper' })).not.toBeInTheDocument()
    expect(screen.getByTitle('Ny variant (kopi av denne)')).toBeInTheDocument()
  })

  it('gives a tablet the ⋯ menu, but its columns, both views and the save state in words', async () => {
    stubMatchMedia({ [COMPACT_QUERY]: true, [NARROW_QUERY]: false })
    await openEditor()
    expect(screen.getByRole('button', { name: 'Flere valg' })).toBeInTheDocument()
    expect(screen.queryByTitle('Ny variant (kopi av denne)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2D + 3D' })).toHaveClass('active')
    expect(screen.getByText('3D-visning')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Egenskaper' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveClass('dot')
    expect(screen.getByRole('status')).toHaveTextContent('Lagret')

    fireEvent.click(screen.getByRole('button', { name: 'Flere valg' }))
    expect(
      within(screen.getByRole('group', { name: 'Flere valg' })).getByTitle('Ny variant (kopi av denne)'),
    ).toBeVisible()
  })

  describe('on a phone', () => {
    let media: ReturnType<typeof stubMatchMedia>
    beforeEach(() => {
      media = stubMatchMedia({ [NARROW_QUERY]: true })
    })

    it('draws the side-by-side view as 2D without changing it, and has no side-by-side choice', async () => {
      await openEditor()
      expect(screen.getByText('2D-plan')).toBeInTheDocument()
      expect(screen.queryByText('3D-visning')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '2D' })).toHaveClass('active')
      expect(screen.queryByRole('button', { name: '2D + 3D' })).not.toBeInTheDocument()
      expect(state().view).toBe('split')

      fireEvent.click(screen.getByRole('button', { name: '3D' }))
      expect(screen.queryByText('2D-plan')).not.toBeInTheDocument()
      act(() => state().setView('split'))

      // Wide again: both side by side, as the store said all along
      media.set(NARROW_QUERY, false)
      expect(screen.getByText('2D-plan')).toBeInTheDocument()
      expect(screen.getByText('3D-visning')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '2D + 3D' })).toHaveClass('active')
    })

    it('puts the inspector in a bottom sheet, and leaves it out in focus mode and when comparing', async () => {
      await openEditor()
      const sheet = screen.getByRole('region', { name: 'Egenskaper' })
      expect(within(sheet).getByText('Inspektør')).toBeInTheDocument()
      expect(screen.getAllByText('Inspektør')).toHaveLength(1)

      fireEvent.click(screen.getByRole('button', { name: 'Sammenlign' }))
      expect(screen.queryByRole('region', { name: 'Egenskaper' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '2D' }))
      expect(screen.getByRole('region', { name: 'Egenskaper' })).toBeInTheDocument()

      act(() => state().setFocus(true))
      expect(screen.queryByText('Inspektør')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Vegg/ })).not.toBeInTheDocument()
    })

    it('shows the save state as a dot, and in words when the save failed', async () => {
      const { server } = await openEditor()
      const status = screen.getByRole('status')
      expect(status).toHaveClass('dot')
      expect(status).toHaveTextContent('Lagret')

      server.answers.push(400)
      fireEvent.change(nameField(), { target: { value: 'Hytta' } })
      hideTab()
      const retry = await screen.findByRole('button', { name: 'Ikke lagret – prøv igjen' })
      expect(retry).not.toHaveClass('dot')

      fireEvent.click(retry)
      await waitFor(() => expect(screen.getByRole('status')).toHaveClass('dot'))
    })

    it('keeps variants, focus, print and the key in the ⋯ menu', async () => {
      await openEditor()
      const prompt = vi.fn(() => 'Åpent kjøkken')
      vi.stubGlobal('prompt', prompt)
      expect(screen.queryByTitle('Ny variant (kopi av denne)')).not.toBeInTheDocument()
      const more = screen.getByRole('button', { name: 'Flere valg' })
      expect(more).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(more)
      expect(more).toHaveAttribute('aria-expanded', 'true')
      const menu = screen.getByRole('group', { name: 'Flere valg' })
      fireEvent.click(within(menu).getByTitle('Ny variant (kopi av denne)'))
      expect(state().project!.scenarios).toHaveLength(2)
      // A button in the menu closes it
      expect(screen.queryByRole('group', { name: 'Flere valg' })).not.toBeInTheDocument()

      // Picking a variant leaves it open
      fireEvent.click(more)
      const first = state().project!.scenarios[0]!.id
      fireEvent.change(within(screen.getByRole('group', { name: 'Flere valg' })).getByRole('combobox'), {
        target: { value: first },
      })
      expect(state().project!.activeScenarioId).toBe(first)
      expect(screen.getByRole('group', { name: 'Flere valg' })).toBeInTheDocument()

      // Escape and a tap outside close it
      key('Escape')
      expect(screen.queryByRole('group', { name: 'Flere valg' })).not.toBeInTheDocument()
      fireEvent.click(more)
      fireEvent.pointerDown(screen.getByText('2D-plan'))
      expect(screen.queryByRole('group', { name: 'Flere valg' })).not.toBeInTheDocument()

      fireEvent.click(more)
      fireEvent.click(within(screen.getByRole('group', { name: 'Flere valg' })).getByRole('button', { name: 'Fokus' }))
      expect(state().focus).toBe(true)
      fireEvent.click(more)
      fireEvent.click(screen.getByRole('button', { name: 'Skriv ut' }))
      expect(window.location.hash).toBe('#/p/p_ed/print')
    })

    it('keeps the tool settings in a group of their own', async () => {
      await openEditor()
      expect(document.querySelector('.tool-options')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /Vegg/ }))
      expect(screen.getByRole('combobox', { name: 'Tykkelse' }).closest('.tool-options')).not.toBeNull()
    })
  })
})
