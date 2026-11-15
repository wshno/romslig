// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { emptyScenario, type Project, type RecognizeResult, type RecognizedItem, type Room } from '@romslig/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { RecognizePanel } from './RecognizePanel.tsx'

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
// The real picker draws the room; here it is one button that picks the top wall.
vi.mock('./DirectionPicker.tsx', () => ({
  DirectionPicker: ({ value, onChange }: { value: string | null; onChange(side: string): void }) => (
    <button type="button" onClick={() => onChange('top')}>
      Retning: {value ?? 'ingen'}
    </button>
  ),
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
const scenario = () => activeScenario(state().project!)

function livingRoom(): Room {
  state().addRoom([
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 4 },
    { x: 0, y: 4 },
  ])
  const room = scenario().rooms.at(-1)!
  state().updateRoom(room.id, { name: 'Stue' })
  return scenario().rooms.at(-1)!
}

const item = (over: Partial<RecognizedItem>): RecognizedItem => ({
  catalogId: 'sofa-3',
  name: 'Grå sofa',
  size: { w: 2.1, d: 0.9, h: 0.85 },
  side: 'top',
  positionHint: 'mot vinduet',
  confidence: 'high',
  photo: 1,
  match: 'good',
  proposal: null,
  ...over,
})

const proposal = {
  name: 'Hjørnesofa',
  nameEn: 'Corner sofa',
  category: 'stue' as const,
  shape: 'sofa' as const,
  w: 2.6,
  d: 1.6,
  h: 0.8,
  clearance: { front: 0.5, back: 0, sides: 0.1 },
  descriptionEn: 'An L-shaped sofa',
  needsNewShape: true,
}

const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

function choosePhotos(files: File[]) {
  // The input has no label of its own; it is the only file input in the panel
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } })
}

describe('RecognizePanel', () => {
  let room: Room
  const onClose = vi.fn()

  beforeEach(() => {
    state().load(newProject())
    resetHistory()
    room = livingRoom()
    onClose.mockReset()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
    ai.prepareImage.mockResolvedValue({ mediaType: 'image/jpeg', data: 'AAAA' })
    ai.withAi.mockImplementation((action: (client: unknown) => Promise<unknown>) => action({}))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('asks for photos of the room before it can run', () => {
    render(<RecognizePanel room={room} onClose={onClose} />)

    expect(screen.getByText(/Last opp 1–4 bilder av «Stue»/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Lukk' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('sends up to four photos, with the wall each faces and the hint', async () => {
    const result: RecognizeResult = { roomId: room.id, items: [], notes: 'Rommet var tomt.' }
    ai.recognizeFurniture.mockResolvedValue(result)
    render(<RecognizePanel room={room} onClose={onClose} />)

    choosePhotos([1, 2, 3, 4, 5].map((n) => photo(`p${n}.jpg`)))
    expect(screen.getAllByRole('img')).toHaveLength(4)
    fireEvent.click(screen.getAllByRole('button', { name: 'Retning: ingen' })[1]!)
    expect(screen.getByRole('button', { name: 'Retning: top' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Tips til Claude'), { target: { value: 'sengen er 180 cm' } })
    fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))

    expect(await screen.findByText('Fant ingen møbler.')).toBeInTheDocument()
    expect(screen.getByText('Rommet var tomt.')).toBeInTheDocument()
    const request = ai.recognizeFurniture.mock.calls[0]![1] as {
      roomId: string
      hint: string
      images: { facing: string | null }[]
    }
    expect(request.roomId).toBe(room.id)
    expect(request.hint).toBe('sengen er 180 cm')
    expect(request.images.map((i) => i.facing)).toEqual([null, 'top', null, null])
  })

  it('shows the error when recognition fails, and nothing when the key dialog took over', async () => {
    ai.recognizeFurniture.mockRejectedValue(new Error('Claude er overbelastet.'))
    render(<RecognizePanel room={room} onClose={onClose} />)
    choosePhotos([photo('a.jpg')])

    fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))
    expect(await screen.findByText('Claude er overbelastet.')).toBeInTheDocument()

    ai.withAi.mockResolvedValue(null)
    fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' })).toBeEnabled())
    expect(screen.queryByText('Claude er overbelastet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('places the chosen items in the room, leaving unsure ones out unless picked', async () => {
    ai.recognizeFurniture.mockResolvedValue({
      roomId: room.id,
      items: [
        item({}),
        item({ catalogId: 'lenestol', name: 'Lenestol', size: { w: 1, d: 1, h: 1 }, side: 'free', confidence: 'low' }),
        item({
          catalogId: 'plante',
          name: 'Plante',
          confidence: 'medium',
          side: 'left',
          size: { w: 0.4, d: 0.4, h: 1.2 },
        }),
      ],
      notes: '',
    } satisfies RecognizeResult)
    render(<RecognizePanel room={room} onClose={onClose} />)
    choosePhotos([photo('a.jpg')])
    fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))

    const [sofa, chair, plant] = await screen.findAllByRole('checkbox')
    expect(sofa).toBeChecked()
    expect(chair).not.toBeChecked()
    expect(plant).toBeChecked()
    expect(screen.getByText('usikker')).toBeInTheDocument()
    expect(screen.getByText(/frittstående/)).toBeInTheDocument()

    fireEvent.click(plant!)
    fireEvent.click(chair!)
    fireEvent.click(screen.getByRole('button', { name: 'Legg inn 2 møbler' }))

    expect(onClose).toHaveBeenCalled()
    const furniture = scenario().furniture
    expect(furniture.map((f) => f.label).sort()).toEqual(['Grå sofa', 'Lenestol'])
    expect(furniture.every((f) => f.roomId === room.id)).toBe(true)
    // The chair's size differs from the catalog's, so it keeps its own
    expect(furniture.find((f) => f.label === 'Lenestol')!.size).toEqual({ w: 1, d: 1, h: 1 })
    expect(furniture.find((f) => f.label === 'Grå sofa')!.size).toBeNull()
  })

  it('adds an item the catalog lacks as the project’s own furniture type, or as the nearest one', async () => {
    ai.recognizeFurniture.mockResolvedValue({
      roomId: room.id,
      items: [
        item({ name: 'L-sofa', match: 'none', proposal, size: { w: 2.6, d: 1.6, h: 0.8 } }),
        item({
          name: 'Lenestol',
          catalogId: 'lenestol',
          match: 'approximate',
          proposal: { ...proposal, name: 'Øreklappstol' },
        }),
      ],
      notes: '',
    } satisfies RecognizeResult)
    render(<RecognizePanel room={room} onClose={onClose} />)
    choosePhotos([photo('a.jpg')])
    fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))

    expect(await screen.findByText('Ikke i katalogen')).toBeInTheDocument()
    expect(screen.getByText(/Ligner på «/)).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'Foreslå for katalogen ↗' })
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('github.com'))

    const ownChair = screen.getByRole('checkbox', { name: 'Legg inn som eget møbel «Øreklappstol»' })
    expect(ownChair).toBeChecked()
    fireEvent.click(ownChair)
    fireEvent.click(screen.getByRole('button', { name: 'Legg inn 2 møbler' }))

    const own = state().project!.customFurniture
    expect(own.map((c) => c.name)).toEqual(['Hjørnesofa'])
    const sofa = scenario().furniture.find((f) => f.label === 'L-sofa')!
    expect(sofa.catalogId).toBe(own[0]!.id)
    expect(scenario().furniture.find((f) => f.label === 'Lenestol')!.catalogId).toBe('lenestol')
  })

  it('goes back to the photos on Prøv igjen', async () => {
    ai.recognizeFurniture.mockResolvedValue({ roomId: room.id, items: [item({})], notes: '' })
    render(<RecognizePanel room={room} onClose={onClose} />)
    choosePhotos([photo('a.jpg')])
    fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))
    expect(await screen.findByText('Grå sofa')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }))

    expect(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' })).toBeInTheDocument()
  })
})
