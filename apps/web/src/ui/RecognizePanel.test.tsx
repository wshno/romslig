// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const STORAGE_KEY = 'romslig.recognize'

/** Picks files in one of the two hidden inputs, and waits until they are downscaled. */
async function choosePhotos(files: File[], input: 'photo-files' | 'photo-camera' = 'photo-files') {
  fireEvent.change(screen.getByTestId(input), { target: { files } })
  await waitFor(() => expect(screen.queryByText('Gjør klar bildet…')).not.toBeInTheDocument())
}

const photos = () => screen.queryAllByRole('img')

describe('RecognizePanel', () => {
  let room: Room
  const onClose = vi.fn()

  beforeEach(() => {
    state().load(newProject())
    resetHistory()
    room = livingRoom()
    onClose.mockReset()
    sessionStorage.removeItem(STORAGE_KEY)
    useStore.getState().setView('2d')
    ai.prepareImage.mockResolvedValue({ mediaType: 'image/jpeg', data: 'AAAA' })
    ai.withAi.mockImplementation((action: (client: unknown) => Promise<unknown>) => action({}))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('asks for photos of the room before it can run', () => {
    render(<RecognizePanel room={room} onClose={onClose} />)

    expect(screen.getByText(/Bruk 1–4 bilder av «Stue»/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' })).toBeDisabled()
    // The camera opens straight away from its own input; the other picks several from the gallery
    expect(screen.getByRole('button', { name: '📷 Ta bilde' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Velg fra bilder' })).toBeEnabled()
    expect(screen.getByTestId('photo-camera')).toHaveAttribute('capture', 'environment')
    expect(screen.getByTestId('photo-camera')).not.toHaveAttribute('multiple')
    expect(screen.getByTestId('photo-files')).toHaveAttribute('multiple')
    expect(screen.getByTestId('photo-files')).not.toHaveAttribute('capture')

    fireEvent.click(screen.getByRole('button', { name: 'Lukk' }))
    expect(onClose).toHaveBeenCalled()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('opens the camera or the gallery from the buttons', () => {
    render(<RecognizePanel room={room} onClose={onClose} />)
    const camera = vi.spyOn(screen.getByTestId('photo-camera'), 'click').mockImplementation(() => {})
    const files = vi.spyOn(screen.getByTestId('photo-files'), 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('button', { name: '📷 Ta bilde' }))
    expect(camera).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Velg fra bilder' }))
    expect(files).toHaveBeenCalledTimes(1)
  })

  it('adds photos one at a time, up to four, and each can be removed', async () => {
    render(<RecognizePanel room={room} onClose={onClose} />)
    const camera = screen.getByTestId('photo-camera') as HTMLInputElement
    // Spy on the reset: without it, picking the same file again would fire no change event
    const reset = vi.fn()
    Object.defineProperty(camera, 'value', { configurable: true, get: () => '', set: reset })

    await choosePhotos([photo('a.jpg')], 'photo-camera')
    expect(reset).toHaveBeenCalledWith('')
    await choosePhotos([photo('a.jpg')], 'photo-camera')
    expect(photos()).toHaveLength(2)
    expect(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' })).toBeEnabled()

    await choosePhotos([photo('b.jpg'), photo('c.jpg'), photo('d.jpg')])
    expect(photos()).toHaveLength(4)
    expect(screen.getByText(/Bare 4 bilder kan brukes/)).toBeInTheDocument()
    expect(screen.getByText(/Fire bilder er nok/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '📷 Ta bilde' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Velg fra bilder' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Fjern bilde 2' }))
    expect(photos()).toHaveLength(3)
    expect(photos().map((img) => img.getAttribute('alt'))).toEqual(['Bilde 1', 'Bilde 2', 'Bilde 3'])
    expect(screen.getByRole('button', { name: '📷 Ta bilde' })).toBeEnabled()
    expect(ai.prepareImage).toHaveBeenCalledTimes(4)
  })

  it('keeps the wall each photo faces with that photo when another is removed', async () => {
    render(<RecognizePanel room={room} onClose={onClose} />)
    await choosePhotos([photo('a.jpg'), photo('b.jpg')])

    // The newest photo is last, with its direction picker right under it
    const items = screen.getAllByRole('listitem')
    expect(items.at(-1)).toHaveClass('newest')
    fireEvent.click(within(items[1]!).getByRole('button', { name: 'Retning: ingen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fjern bilde 1' }))

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Retning: top' })).toBeInTheDocument()
  })

  it('says so when a photo cannot be read', async () => {
    ai.prepareImage.mockRejectedValueOnce(new Error('decode'))
    render(<RecognizePanel room={room} onClose={onClose} />)

    await choosePhotos([photo('a.heic')], 'photo-camera')

    expect(screen.getByText(/Klarte ikke å lese bildet/)).toBeInTheDocument()
    expect(photos()).toHaveLength(0)
  })

  it('keeps the screen on while Claude works, and lets go afterwards', async () => {
    const release = vi.fn(() => Promise.resolve())
    const request = vi.fn(() => Promise.resolve({ release }))
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    let finish: (r: RecognizeResult) => void = () => {}
    ai.recognizeFurniture.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    try {
      render(<RecognizePanel room={room} onClose={onClose} />)
      await choosePhotos([photo('a.jpg')])
      fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))

      expect(await screen.findByText(/La siden stå åpen/)).toBeInTheDocument()
      expect(request).toHaveBeenCalledWith('screen')
      expect(release).not.toHaveBeenCalled()
      finish({ roomId: room.id, items: [], notes: '' })
      expect(await screen.findByText('Fant ingen møbler.')).toBeInTheDocument()
      expect(release).toHaveBeenCalledTimes(1)

      // A refused lock does not stop the recognition
      request.mockRejectedValueOnce(new Error('NotAllowedError'))
      ai.recognizeFurniture.mockResolvedValue({ roomId: room.id, items: [], notes: 'Igjen.' })
      fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }))
      fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))
      expect(await screen.findByText('Igjen.')).toBeInTheDocument()
    } finally {
      delete (navigator as { wakeLock?: unknown }).wakeLock
    }
  })

  it('works without the wake lock API', async () => {
    expect('wakeLock' in navigator).toBe(false)
    ai.recognizeFurniture.mockResolvedValue({ roomId: room.id, items: [], notes: '' })
    render(<RecognizePanel room={room} onClose={onClose} />)
    await choosePhotos([photo('a.jpg')])

    fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))

    expect(await screen.findByText('Fant ingen møbler.')).toBeInTheDocument()
  })

  it('keeps the room and photos for this tab, and brings them back after a reload', async () => {
    const first = render(<RecognizePanel room={room} onClose={onClose} />)
    await choosePhotos([photo('a.jpg'), photo('b.jpg')])
    fireEvent.click(screen.getAllByRole('button', { name: 'Retning: ingen' })[0]!)
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!) as {
      projectId: string
      roomId: string
      photos: { data: string; facing: string | null }[]
    }
    expect(saved.projectId).toBe('p_test')
    expect(saved.roomId).toBe(room.id)
    expect(saved.photos.map((p) => [p.data, p.facing])).toEqual([
      ['AAAA', 'top'],
      ['AAAA', null],
    ])
    first.unmount() // the tab is gone

    render(<RecognizePanel room={room} onClose={onClose} />)
    expect(photos()).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^Retning:/ }).map((b) => b.textContent)).toEqual([
      'Retning: top',
      'Retning: ingen',
    ])
    expect(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' })).toBeEnabled()
  })

  it('does not restore photos stored for another project or room', () => {
    const stored = (projectId: string, roomId: string) =>
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          projectId,
          roomId,
          photos: [{ id: 'ph_1', mediaType: 'image/jpeg', data: 'AAAA', facing: null }],
        }),
      )
    stored('p_other', room.id)
    const first = render(<RecognizePanel room={room} onClose={onClose} />)
    expect(photos()).toHaveLength(0)
    first.unmount()

    stored('p_test', 'r_other')
    render(<RecognizePanel room={room} onClose={onClose} />)
    expect(photos()).toHaveLength(0)
    // The panel now open is the one stored
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toMatchObject({ roomId: room.id, photos: [] })
  })

  it('still takes photos when the storage is full', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    try {
      render(<RecognizePanel room={room} onClose={onClose} />)
      await choosePhotos([photo('a.jpg')], 'photo-camera')
      expect(photos()).toHaveLength(1)
      expect(setItem).toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
    }
  })

  it('sends up to four photos, with the wall each faces and the hint', async () => {
    const result: RecognizeResult = { roomId: room.id, items: [], notes: 'Rommet var tomt.' }
    ai.recognizeFurniture.mockResolvedValue(result)
    render(<RecognizePanel room={room} onClose={onClose} />)

    await choosePhotos([1, 2, 3, 4, 5].map((n) => photo(`p${n}.jpg`)))
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
    await choosePhotos([photo('a.jpg')])

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
    await choosePhotos([photo('a.jpg')])
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
    // The new furniture is selected, and the stored panel is gone
    expect(state().selection).toEqual(furniture.map((f) => ({ kind: 'furniture', id: f.id })))
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('shows the plan in 2D after adding from 3D or the comparison, but leaves 2D + 3D alone', async () => {
    ai.recognizeFurniture.mockResolvedValue({ roomId: room.id, items: [item({})], notes: '' })
    for (const [from, to] of [
      ['3d', '2d'],
      ['compare', '2d'],
      ['split', 'split'],
    ] as const) {
      state().setView(from)
      const view = render(<RecognizePanel room={room} onClose={onClose} />)
      await choosePhotos([photo('a.jpg')])
      fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Legg inn 1 møbler' }))

      expect(state().view).toBe(to)
      expect(state().selection).toEqual([{ kind: 'furniture', id: scenario().furniture.at(-1)!.id }])
      view.unmount()
    }
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
    await choosePhotos([photo('a.jpg')])
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
    await choosePhotos([photo('a.jpg')])
    fireEvent.click(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' }))
    expect(await screen.findByText('Grå sofa')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }))

    expect(screen.getByRole('button', { name: '✨ Gjenkjenn møbler' })).toBeInTheDocument()
  })
})
