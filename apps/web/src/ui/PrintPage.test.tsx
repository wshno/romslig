// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { emptyScenario, type Project } from '@romslig/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { PrintPage } from './PrintPage.tsx'

const download = vi.hoisted(() => ({ saveFile: vi.fn(), svgToPng: vi.fn() }))
vi.mock('../download.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../download.ts')>()),
  saveFile: download.saveFile,
  svgToPng: download.svgToPng,
}))

function newProject(over: Partial<Project> = {}): Project {
  const scenario = emptyScenario()
  return {
    id: 'p_print',
    name: 'Leiligheten',
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
    ...over,
  }
}

const state = () => useStore.getState()

/** Loads a project with one room (with a sofa), one sofa outside it, and a second, empty variant. */
function furnishedProject(): Project {
  state().load(newProject())
  resetHistory()
  state().addRoom([
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ])
  const room = activeScenario(state().project!).rooms[0]!
  state().updateRoom(room.id, { name: 'Stue' })
  state().addFurniture('sofa-3', { x: 2, y: 1.5 }, { snap: false })
  state().addFurniture('sofa-3', { x: 10, y: 10 }, { snap: false })
  state().updateProject((p) => ({ ...p, scenarios: [...p.scenarios, { ...emptyScenario('Ny plan'), id: 'sc_new' }] }))
  return state().project!
}

describe('PrintPage', () => {
  beforeEach(() => {
    document.title = 'Romslig'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('prints the open project: the plan, the rooms with areas and the furniture by room', () => {
    const project = furnishedProject()
    const { unmount } = render(<PrintPage projectId={project.id} />)

    expect(document.title).toBe('Leiligheten – Romslig')
    expect(screen.getByRole('heading', { level: 1, name: 'Leiligheten' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Plantegning av Eksisterende' })).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/svg\+xml/),
    )
    expect(screen.getByRole('link', { name: '← Tilbake til prosjektet' })).toHaveAttribute('href', '#/p/p_print')

    const [rooms, furniture] = screen.getAllByRole('table')
    expect(within(rooms!).getByRole('cell', { name: 'Stue' })).toBeInTheDocument()
    expect(within(rooms!).getAllByRole('cell', { name: /12[,.]0 m²/ })).toHaveLength(2)
    expect(within(furniture!).getByRole('columnheader', { name: 'Stue' })).toBeInTheDocument()
    expect(within(furniture!).getByRole('columnheader', { name: 'Utenfor rommene' })).toBeInTheDocument()
    expect(within(furniture!).getAllByRole('cell', { name: '210 × 90 × 85' })).toHaveLength(2)
    expect(within(furniture!).getByRole('columnheader', { name: 'Nr.' })).toBeInTheDocument()
    expect(screen.queryByText(/ikke kalibrert/)).not.toBeInTheDocument()

    unmount()
    expect(document.title).toBe('Romslig')
  })

  it('switches variant, prints all of them, and leaves out dimensions and numbers when asked', () => {
    const project = furnishedProject()
    render(<PrintPage projectId={project.id} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sc_new' } })
    expect(screen.getByText('Ingen rom er tegnet.')).toBeInTheDocument()
    expect(screen.getByText('Ingen møbler i denne varianten.')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(2)

    expect(screen.getAllByText(/Mål inne i rommene/)).toHaveLength(2)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mål' }))
    expect(screen.queryByText(/Mål inne i rommene/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Møbler' }))
    expect(screen.queryByRole('columnheader', { name: 'Nr.' })).not.toBeInTheDocument()
  })

  it('opens the print dialog', () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    render(<PrintPage projectId={furnishedProject().id} />)

    fireEvent.click(screen.getByRole('button', { name: 'Skriv ut eller lagre som PDF' }))

    expect(print).toHaveBeenCalled()
  })

  it('saves the plan as a PNG named after the project and variant, or says why it could not', async () => {
    const png = new Blob(['png'], { type: 'image/png' })
    download.svgToPng.mockResolvedValueOnce(png).mockRejectedValueOnce(new Error('Kunne ikke lage bildet.'))
    render(<PrintPage projectId={furnishedProject().id} />)

    fireEvent.click(screen.getByRole('button', { name: 'Last ned som PNG' }))
    await waitFor(() => expect(download.saveFile).toHaveBeenCalledWith('romslig-leiligheten-eksisterende.png', png))

    fireEvent.click(screen.getByRole('button', { name: 'Last ned som PNG' }))
    expect(await screen.findByText(/Kunne ikke lage bildet\./)).toBeInTheDocument()
  })

  it('fetches a project that is not open, and warns when the plan is not calibrated', async () => {
    state().load(newProject({ id: 'p_other' }))
    const fetched = newProject({
      id: 'p_print',
      name: '  ',
      planImage: { width: 1000, height: 800 } as Project['planImage'],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(fetched))),
    )
    render(<PrintPage projectId="p_print" />)
    expect(screen.getByText('Laster prosjekt…')).toBeInTheDocument()

    expect(await screen.findByText(/Målestokken er ikke kalibrert/)).toBeInTheDocument()
    expect(document.title).toBe('Prosjekt – Romslig')
  })

  it('says why a project could not be fetched', async () => {
    state().load(newProject({ id: 'p_other' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ error: 'Fant ikke prosjektet.' }, { status: 404 }))),
    )
    render(<PrintPage projectId="p_gone" />)

    expect(await screen.findByText('Fant ikke prosjektet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Tilbake' })).toHaveAttribute('href', '#/')
  })

  it('ignores the answer when the page was left before it came', async () => {
    state().load(newProject({ id: 'p_other' }))
    const pending: { answer?: (r: Response) => void } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pending.answer = resolve
          }),
      ),
    )
    const { unmount } = render(<PrintPage projectId="p_print" />)
    unmount()

    pending.answer?.(Response.json({ error: 'for sent' }, { status: 500 }))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('for sent')).not.toBeInTheDocument()
  })
})
