// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { emptyScenario, type Project, type Room } from '@romslig/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { BottomSheet } from './BottomSheet.tsx'
import { PhotoEntry } from './PhotoEntry.tsx'

// The photo flow inside the phone's bottom sheet: how far up the sheet is while the room list and
// the panel show, and where it goes after. RecognizePanel.test.tsx covers the panel itself.

const ai = vi.hoisted(() => ({
  recognizeFurniture: vi.fn(),
  withAi: vi.fn(),
  prepareImage: vi.fn(),
}))
vi.mock('@romslig/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@romslig/ai')>()),
  recognizeFurniture: ai.recognizeFurniture,
}))
vi.mock('../ai/client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/client.ts')>()),
  withAi: ai.withAi,
}))
vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  prepareImage: ai.prepareImage,
}))

function newProject(): Project {
  const scenario = emptyScenario()
  return {
    id: 'p_photo',
    name: 'Bilder',
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
const scenario = () => activeScenario(state().project!)
const STORAGE_KEY = 'romslig.recognize'

function livingRoom(): Room {
  state().addRoom([
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 4 },
    { x: 0, y: 4 },
  ])
  state().updateRoom(scenario().rooms.at(-1)!.id, { name: 'Stue' })
  return scenario().rooms.at(-1)!
}

/** The Oversikt tab in short: the photo entry, gone while the assistant tab shows. */
function FakeInspector() {
  const tab = useStore((s) => s.inspectorTab)
  return (
    <aside className="inspector">
      <div className="tabs">
        <button>Oversikt</button>
      </div>
      {tab !== 'assistent' && <PhotoEntry />}
    </aside>
  )
}

function renderSheet() {
  return render(
    <div>
      <BottomSheet label="Egenskaper">
        <FakeInspector />
      </BottomSheet>
    </div>,
  )
}

const sheet = () => screen.getByRole('region', { name: 'Egenskaper' })
const handle = () => screen.getByRole('button', { name: /panelet/ })
const entry = () => screen.getByRole('button', { name: '📷 Ta bilde av et rom' })

describe('the photo flow in the bottom sheet', () => {
  let room: Room

  beforeEach(() => {
    state().load(newProject())
    resetHistory()
    room = livingRoom()
    useStore.setState({ tool: 'select', selection: [], inspectorTab: 'oversikt' })
    useStore.getState().setView('2d')
    sessionStorage.removeItem(STORAGE_KEY)
    ai.prepareImage.mockResolvedValue({ mediaType: 'image/jpeg', data: 'AAAA' })
    ai.withAi.mockImplementation((action: (client: unknown) => Promise<unknown>) => action({}))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('takes the whole height for the room list and the panel, and Avbryt or Lukk put it back', () => {
    renderSheet()
    fireEvent.click(handle())
    expect(sheet()).toHaveClass('half')

    fireEvent.click(entry())
    expect(screen.getByRole('list', { name: 'Velg rom' })).toBeInTheDocument()
    expect(sheet()).toHaveClass('full')
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }))
    expect(sheet()).toHaveClass('half')

    fireEvent.click(entry())
    fireEvent.click(screen.getByRole('button', { name: /Stue/ }))
    expect(screen.getByText(/Bruk 1–4 bilder av «Stue»/)).toBeInTheDocument()
    expect(sheet()).toHaveClass('full')

    // The sheet's own reactions wait while the panel is open
    act(() => state().setTool('wall'))
    expect(sheet()).toHaveClass('full')
    act(() => state().setTool('select'))
    act(() => state().select({ kind: 'room', id: room.id }))
    expect(sheet()).toHaveClass('full')
    act(() => state().select(null))

    fireEvent.click(screen.getByRole('button', { name: 'Lukk' }))
    expect(sheet()).toHaveClass('half')
    expect(entry()).toBeInTheDocument()

    // Afterwards it follows the editor again
    act(() => state().setTool('wall'))
    expect(sheet()).toHaveClass('closed')
  })

  it('can still be moved by hand while the panel is open', () => {
    renderSheet()
    fireEvent.click(handle())
    fireEvent.click(entry())
    expect(sheet()).toHaveClass('full')
    fireEvent.click(handle())
    expect(sheet()).toHaveClass('closed')
  })

  it('goes down after Legg inn and stays down, with the new furniture selected', async () => {
    ai.recognizeFurniture.mockResolvedValue({
      roomId: room.id,
      items: [
        {
          catalogId: 'sofa-3',
          name: 'Grå sofa',
          size: { w: 2.1, d: 0.9, h: 0.85 },
          side: 'top',
          positionHint: 'mot vinduet',
          confidence: 'high',
          photo: 1,
          match: 'good',
          proposal: null,
        },
        {
          catalogId: 'plante',
          name: 'Plante',
          size: { w: 0.4, d: 0.4, h: 1.2 },
          side: 'left',
          positionHint: 'i hjørnet',
          confidence: 'medium',
          photo: 1,
          match: 'good',
          proposal: null,
        },
      ],
      notes: '',
    })
    renderSheet()
    fireEvent.click(handle())
    fireEvent.click(entry())
    fireEvent.click(screen.getByRole('button', { name: /Stue/ }))

    fireEvent.change(screen.getByTestId('photo-camera'), {
      target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] },
    })
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Legg inn 2 møbler' }))

    expect(sheet()).toHaveClass('closed')
    expect(handle()).toHaveAttribute('aria-expanded', 'false')
    const furniture = scenario().furniture
    expect(furniture).toHaveLength(2)
    expect(state().selection).toEqual(furniture.map((f) => ({ kind: 'furniture', id: f.id })))
    expect(entry()).toBeInTheDocument()
  })

  it('opens all the way for a panel brought back after a reload', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        projectId: 'p_photo',
        roomId: room.id,
        photos: [{ id: 'ph_1', mediaType: 'image/jpeg', data: 'AAAA', facing: 'top' }],
      }),
    )
    renderSheet()
    expect(sheet()).toHaveClass('full')
    expect(screen.getAllByRole('img')).toHaveLength(1)

    // Closing it leaves the sheet where it started
    fireEvent.click(screen.getByRole('button', { name: 'Lukk' }))
    expect(sheet()).toHaveClass('closed')
  })

  it('shows the Oversikt tab for a stored panel when the assistant had the sheet', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ projectId: 'p_photo', roomId: room.id, photos: [] }))
    useStore.setState({ inspectorTab: 'assistent' })
    renderSheet()
    expect(state().inspectorTab).toBe('oversikt')
    expect(screen.getByText(/Bruk 1–4 bilder av «Stue»/)).toBeInTheDocument()
    expect(sheet()).toHaveClass('full')
  })
})
