// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyScenario, polygonArea, type DigitizeSuggestion, type Project } from '@romslig/shared'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { Inspector } from './Inspector.tsx'

// The assistant and photo recognition panels have tests of their own; here they only need to show up.
vi.mock('./AssistantPanel.tsx', () => ({
  AssistantPanel: () => <p>assistent-panel</p>,
  NotesList: ({ roomId }: { roomId?: string }) => <p>{`notater ${roomId ?? 'alle'}`}</p>,
}))
vi.mock('./RecognizePanel.tsx', () => ({
  RecognizePanel: ({ room, onClose }: { room: { name: string }; onClose(): void }) => (
    <div>
      <p>{`gjenkjenning for ${room.name}`}</p>
      <button onClick={onClose}>lukk gjenkjenning</button>
    </div>
  ),
}))

const ai = vi.hoisted(() => ({
  withAi: vi.fn(),
  uploadPlan: vi.fn(),
  preparePlanForAi: vi.fn(),
  digitizePlan: vi.fn(),
}))
vi.mock('@romslig/ai', async (original) => ({
  ...(await original<typeof import('@romslig/ai')>()),
  digitizePlan: ai.digitizePlan,
}))
vi.mock('../ai/client.ts', () => ({ withAi: ai.withAi }))
vi.mock('../api.ts', () => ({ api: { uploadPlan: ai.uploadPlan }, preparePlanForAi: ai.preparePlanForAi }))

function newProject(patch: Partial<Project> = {}): Project {
  const scenario = emptyScenario()
  return {
    id: 'p_test',
    name: 'Test',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: false },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [{ ...scenario, name: 'Nå' }],
    activeScenarioId: scenario.id,
    chat: [],
    customFurniture: [],
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

const PLAN = { file: 'plan.png', width: 800, height: 600 }
const s = () => useStore.getState()
const project = () => s().project!
const scenario = () => activeScenario(project())

function room() {
  const top = s().addWall({ x: 0, y: 0 }, { x: 4, y: 0 })
  s().addWall({ x: 4, y: 0 }, { x: 4, y: 3 })
  s().addWall({ x: 4, y: 3 }, { x: 0, y: 3 })
  s().addWall({ x: 0, y: 3 }, { x: 0, y: 0 })
  s().detectRooms()
  return top
}

const spin = (name: string) => screen.getByRole('spinbutton', { name: new RegExp(`^${name}`) })
const button = (name: string | RegExp) => screen.getByRole('button', { name })
/** A store change made from the test while the panel is mounted. */
const change = (fn: () => void) => act(fn)

beforeEach(() => {
  s().load(newProject())
  resetHistory()
  s().setInspectorTab('oversikt')
  sessionStorage.removeItem('romslig.recognize')
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('the overview', () => {
  it('asks for calibration, and finds rooms', () => {
    render(<Inspector />)

    expect(screen.getByText(/Ikke kalibrert\./)).toBeInTheDocument()
    fireEvent.click(button('📏 Kalibrer'))
    expect(s().tool).toBe('calibrate')

    fireEvent.click(button('Finn rom automatisk'))
    expect(screen.getByText(/Fant ingen lukkede rom/)).toBeInTheDocument()

    change(() => {
      room()
      s().updateScenario((sc) => ({ ...sc, rooms: [] }))
    })
    fireEvent.click(button('Finn rom automatisk'))
    expect(screen.getByText('Fant 1 rom.')).toBeInTheDocument()
    expect(screen.getByText(/^Sum:/)).toHaveTextContent(/^Sum: \d+,\d m²$/)
  })

  it('lists the rooms with their deviation from the stated area, and selects one on click', () => {
    room()
    s().updateRoom(scenario().rooms[0]!.id, { name: 'Stue', statedArea: 14 })
    s().updateProject((p) => ({ ...p, calibration: { pxPerMeter: 52.5, calibrated: true } }))
    render(<Inspector />)

    expect(screen.getByText('Kalibrert (52.5 px/m)')).toBeInTheDocument()
    expect(screen.getByText(/^-\d+%$/)).toHaveClass('error')
    fireEvent.click(screen.getByText('Stue'))
    expect(s().selection).toEqual([{ kind: 'room', id: scenario().rooms[0]!.id }])
  })

  it('shows the notes of the variant, and sets ceiling height, wall heights and north', () => {
    room()
    s().updateScenario((sc) => ({
      ...sc,
      notes: [{ id: 'n1', roomId: null, text: 'Husk', author: 'user', createdAt: '2026-01-01T00:00:00Z' }],
    }))
    render(<Inspector />)

    expect(screen.getByRole('heading', { name: 'Notater i «Nå»' })).toBeInTheDocument()
    expect(screen.getByText('notater alle')).toBeInTheDocument()

    fireEvent.change(spin('Takhøyde'), { target: { value: '1' } })
    expect(project().ceilingHeight).toBeCloseTo(1.8)
    fireEvent.change(spin('Takhøyde'), { target: { value: '2.6' } })
    fireEvent.click(button('Bruk takhøyden på alle vegger'))
    expect(scenario().walls.map((w) => w.height)).toEqual(scenario().walls.map(() => 2.6))
    fireEvent.change(spin('Nord'), { target: { value: '45' } })
    expect(project().northAngle).toBe(45)
  })
})

describe('taking photos of a room', () => {
  const stored = (roomId: string, projectId = 'p_test') =>
    sessionStorage.setItem('romslig.recognize', JSON.stringify({ projectId, roomId, photos: [] }))

  it('opens from the overview through a list of the rooms', () => {
    room()
    s().updateRoom(scenario().rooms[0]!.id, { name: 'Stue' })
    render(<Inspector />)

    fireEvent.click(button('📷 Ta bilde av et rom'))
    const list = screen.getByRole('list', { name: 'Velg rom' })
    fireEvent.click(within(list).getByRole('button', { name: /Stue/ }))
    expect(screen.getByText('gjenkjenning for Stue')).toBeInTheDocument()
    // The room is not selected in the plan, so the overview stays where it is
    expect(s().selection).toHaveLength(0)

    fireEvent.click(button('lukk gjenkjenning'))
    expect(button('📷 Ta bilde av et rom')).toBeInTheDocument()
  })

  it('explains that rooms come first when the variant has none, and the list can be left', () => {
    render(<Inspector />)

    fireEvent.click(button('📷 Ta bilde av et rom'))
    expect(screen.getByText(/Varianten «Nå» har ingen rom ennå/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Velg rom' })).not.toBeInTheDocument()
    fireEvent.click(button('Avbryt'))
    expect(button('📷 Ta bilde av et rom')).toBeInTheDocument()
  })

  it('is at the top of the furniture tab too', () => {
    room()
    render(<Inspector />)
    fireEvent.click(button('Møbler'))

    fireEvent.click(button('📷 Ta bilde av et rom'))
    expect(screen.getByRole('list', { name: 'Velg rom' })).toBeInTheDocument()
  })

  it('opens the panel again after a reload, for the room it was open for', () => {
    room()
    s().updateRoom(scenario().rooms[0]!.id, { name: 'Kjøkken' })
    stored(scenario().rooms[0]!.id)
    render(<Inspector />)

    expect(screen.getByText('gjenkjenning for Kjøkken')).toBeInTheDocument()
  })

  it('forgets a stored panel whose room is gone, or that belongs to another project', () => {
    room()
    stored('r_gone')
    const first = render(<Inspector />)
    expect(button('📷 Ta bilde av et rom')).toBeInTheDocument()
    expect(sessionStorage.getItem('romslig.recognize')).toBeNull()
    first.unmount()

    stored(scenario().rooms[0]!.id, 'p_other')
    render(<Inspector />)
    expect(button('📷 Ta bilde av et rom')).toBeInTheDocument()
    expect(sessionStorage.getItem('romslig.recognize')).toBeNull()
  })
})

describe('digitizing', () => {
  it('uploads a floor plan to a project without one', async () => {
    ai.uploadPlan.mockResolvedValue({ planImage: PLAN, pxPerMeter: 40 })
    render(<Inspector />)

    expect(screen.getByText('Prosjektet har ingen plantegning ennå.')).toBeInTheDocument()
    const input = screen.getByLabelText('📄 Last opp plantegning')
    fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } })

    await waitFor(() => expect(project().planImage).toEqual(PLAN))
    expect(project().calibration).toEqual({ pxPerMeter: 40, calibrated: false })
    expect(ai.uploadPlan).toHaveBeenCalledWith('p_test', expect.any(File))
  })

  it('shows a failed upload, and asks before replacing a plan', async () => {
    s().load(newProject({ planImage: PLAN }))
    ai.uploadPlan.mockRejectedValue(new Error('For stor fil'))
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    render(<Inspector />)

    const input = screen.getByLabelText('Bytt plantegning')
    fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png')] } })
    expect(confirm).toHaveBeenCalled()
    expect(ai.uploadPlan).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png')] } })
    expect(await screen.findByText('For stor fil')).toBeInTheDocument()

    fireEvent.change(input, { target: { files: [] } })
    expect(ai.uploadPlan).toHaveBeenCalledTimes(1)
  })

  it('shows the AI suggestion, and accepts or discards it', async () => {
    room()
    s().updateProject((p) => ({ ...p, planImage: PLAN }))
    const suggestion: DigitizeSuggestion = {
      walls: [scenario().walls[0]!],
      openings: [],
      rooms: [],
      pxPerMeter: 100,
      scaleSource: 'dimensions',
      notes: 'Usikker på badet',
      warnings: ['Trappen er ikke med'],
    }
    ai.preparePlanForAi.mockResolvedValue({ image: {}, scale: 1 })
    ai.digitizePlan.mockResolvedValue(suggestion)
    ai.withAi.mockImplementation((action: (c: unknown) => Promise<unknown>) => action({}))
    render(<Inspector />)

    fireEvent.click(button('✨ Digitaliser med AI'))
    expect(await screen.findByText(/1 vegger, 0 åpninger,/)).toBeInTheDocument()
    expect(screen.getByText('Målestokk fra målelinjer på tegningen.')).toBeInTheDocument()
    expect(screen.getByText('Usikker på badet')).toBeInTheDocument()
    expect(screen.getByText('Trappen er ikke med')).toBeInTheDocument()
    expect(screen.getByText(/erstattes veggene i varianten «Nå»/)).toBeInTheDocument()

    fireEvent.click(button('Forkast'))
    expect(s().suggestion).toBeNull()

    change(() => s().setSuggestion(suggestion))
    fireEvent.click(await screen.findByRole('button', { name: 'Godta' }))
    expect(s().suggestion).toBeNull()
    expect(scenario().walls).toHaveLength(1)
  })

  it('shows an AI failure, and waits quietly when the key dialog opened instead', async () => {
    s().updateProject((p) => ({ ...p, planImage: PLAN }))
    ai.withAi.mockRejectedValueOnce(new Error('Claude er opptatt')).mockResolvedValueOnce(null)
    render(<Inspector />)

    fireEvent.click(button('✨ Digitaliser med AI'))
    expect(screen.getByText('Dette kan ta 1–3 minutter.')).toBeInTheDocument()
    expect(await screen.findByText('Claude er opptatt')).toBeInTheDocument()

    fireEvent.click(button('✨ Digitaliser med AI'))
    await waitFor(() => expect(screen.queryByText('Claude er opptatt')).not.toBeInTheDocument())
    expect(s().suggestion).toBeNull()
  })
})

describe('tabs', () => {
  it('switches tabs, and a tab click clears the selection', () => {
    const wall = room()
    render(<Inspector />)

    fireEvent.click(button('Møbler'))
    expect(screen.getByRole('heading', { name: 'Katalog' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'I denne varianten' })).toBeInTheDocument()

    fireEvent.click(button('✨ Assistent'))
    expect(screen.getByText('assistent-panel')).toBeInTheDocument()
    expect(button('✨ Assistent')).toHaveClass('active')

    change(() => s().select({ kind: 'wall', id: wall.id }))
    expect(button('✨ Assistent')).not.toHaveClass('active')
    fireEvent.click(button('Oversikt'))
    expect(s().selection).toHaveLength(0)
    expect(screen.getByRole('heading', { name: '1. Målestokk' })).toBeInTheDocument()
  })
})

describe('a selected wall', () => {
  it('edits length, thickness, height, load bearing and exterior, and splits', () => {
    const wall = room()
    s().addOpening('window', wall.id, 2)
    s().select({ kind: 'wall', id: wall.id })
    render(<Inspector />)

    expect(screen.getByRole('heading', { name: 'Vegg' })).toBeInTheDocument()
    expect(screen.getByText(/^1 åpning\(er\)/)).toBeInTheDocument()
    expect(screen.getByText(/rådgivende ingeniør/)).toBeInTheDocument()

    const length = spin('Lengde')
    fireEvent.change(length, { target: { value: '5' } })
    fireEvent.keyDown(length, { key: 'Enter' })
    fireEvent.change(spin('Tykkelse'), { target: { value: '0.01' } })
    fireEvent.change(spin('Høyde'), { target: { value: '0.1' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Bærende' }), { target: { value: 'no' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Yttervegg' }))

    const edited = scenario().walls.find((w) => w.id === wall.id)!
    expect(edited).toMatchObject({ thickness: 0.03, height: 0.5, loadBearing: 'no', exterior: !wall.exterior })
    expect(screen.queryByText(/rådgivende ingeniør/)).not.toBeInTheDocument()

    const before = scenario().walls.length
    fireEvent.click(button('Del vegg'))
    expect(scenario().walls).toHaveLength(before + 1)
  })
})

describe('a selected opening', () => {
  it('edits kind and measures, and a door can swing the other way', () => {
    const wall = room()
    s().addOpening('door', wall.id, 2)
    const id = scenario().openings[0]!.id
    s().select({ kind: 'opening', id })
    render(<Inspector />)

    expect(screen.getByRole('heading', { name: 'Dør' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Slår til motsatt side' }))
    fireEvent.change(spin('Bredde'), { target: { value: '0.1' } })
    fireEvent.change(spin('Høyde'), { target: { value: '0.1' } })
    fireEvent.change(spin('Brystning'), { target: { value: '-1' } })
    fireEvent.change(spin('Posisjon'), { target: { value: '1.5' } })
    expect(scenario().openings[0]).toMatchObject({ flip: true, width: 0.2, height: 0.2, sill: 0, offset: 1.5 })

    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'window' } })
    expect(scenario().openings[0]!.kind).toBe('window')
    expect(screen.getByRole('heading', { name: 'Vindu' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('a selected room', () => {
  it('edits name, type and stated area, and shows the deviation', () => {
    room()
    const id = scenario().rooms[0]!.id
    s().select({ kind: 'room', id })
    render(<Inspector />)

    expect(screen.getByText(/Formen følger veggene/)).toBeInTheDocument()
    expect(screen.getByText(`notater ${id}`)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Navn' }), { target: { value: 'Kontor' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'kontor' } })
    const area = Number(polygonArea(scenario().rooms[0]!.polygon).toFixed(1))
    fireEvent.change(spin('Oppgitt areal'), { target: { value: String(area) } })
    expect(scenario().rooms[0]).toMatchObject({ name: 'Kontor', type: 'kontor', statedArea: area })
    expect(screen.getByText(/Avvik/)).toHaveClass('ok')

    fireEvent.change(spin('Oppgitt areal'), { target: { value: '20' } })
    expect(screen.getByText(/Sjekk kalibrering/)).toHaveClass('error')
    fireEvent.change(spin('Oppgitt areal'), { target: { value: '' } })
    expect(scenario().rooms[0]!.statedArea).toBeNull()
  })

  it('opens photo recognition, and hands over to the assistant', () => {
    s().addRoom([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ])
    s().select({ kind: 'room', id: scenario().rooms[0]!.id })
    render(<Inspector />)

    expect(screen.getByText(/Dra i hjørnene i planen/)).toBeInTheDocument()
    fireEvent.click(button('📷 Gjenkjenn møbler fra bilder'))
    fireEvent.click(button('lukk gjenkjenning'))
    expect(button('📷 Gjenkjenn møbler fra bilder')).toBeInTheDocument()

    fireEvent.click(button('✨ Spør assistenten om rommet'))
    expect(s().selection).toHaveLength(0)
    expect(s().inspectorTab).toBe('assistent')
  })
})

describe('other selections', () => {
  it('shows the panel for furniture, fixtures, runs and lowered ceilings', () => {
    s().addFurniture('lenestol', { x: 1, y: 1 }, { snap: false })
    s().addFixture('outlet', { x: 1, y: 1 }, null)
    s().addRun([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
    s().addLoweredCeiling([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ])
    const sc = scenario()
    render(<Inspector />)

    change(() => s().select({ kind: 'furniture', id: sc.furniture[0]!.id }))
    expect(screen.getByRole('heading', { name: 'Møbel' })).toBeInTheDocument()
    change(() => s().select({ kind: 'fixture', id: sc.fixtures[0]!.id }))
    expect(screen.getByRole('heading', { name: 'Stikkontakt' })).toBeInTheDocument()
    change(() => s().select({ kind: 'run', id: sc.runs[0]!.id }))
    expect(screen.getByRole('heading', { name: 'Kaldtvann' })).toBeInTheDocument()
    change(() => s().select({ kind: 'ceiling', id: sc.loweredCeilings[0]!.id }))
    expect(screen.getByRole('heading', { name: 'Nedforet tak' })).toBeInTheDocument()
  })

  it('falls back to the tab for a selection that no longer exists', () => {
    render(<Inspector />)
    for (const kind of ['fixture', 'run', 'ceiling'] as const) {
      change(() => s().select({ kind, id: 'gone' }))
      expect(screen.getByRole('heading', { name: '1. Målestokk' })).toBeInTheDocument()
    }
  })
})

describe('several selected', () => {
  it('duplicates, copies furniture to another variant, and deletes', () => {
    s().addFurniture('lenestol', { x: 1, y: 1 }, { snap: false })
    s().addFurniture('spisestol', { x: 3, y: 1 }, { snap: false })
    const here = scenario().id
    s().duplicateScenario('Forslag')
    s().setActiveScenario(here)
    s().setSelection(scenario().furniture.map((f) => ({ kind: 'furniture' as const, id: f.id })))
    render(<Inspector />)

    expect(screen.getByRole('heading', { name: 'Flere valgt' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/2/)

    const copyTo = screen.getByRole('combobox', { name: 'Kopier de valgte møblene til en annen variant' })
    fireEvent.change(copyTo, { target: { value: 'missing' } })
    const forslag = project().scenarios.find((x) => x.name === 'Forslag')!
    fireEvent.change(copyTo, { target: { value: forslag.id } })
    expect(screen.getByText('Kopierte 2 møbler til «Forslag».')).toBeInTheDocument()
    expect(project().scenarios.find((x) => x.id === forslag.id)!.furniture).toHaveLength(4)

    fireEvent.click(button('Dupliser'))
    expect(scenario().furniture).toHaveLength(4)

    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Slett' }))
    expect(scenario().furniture.length).toBeLessThan(4)
  })

  it('cannot duplicate walls, and goes back to the overview', () => {
    const wall = room()
    s().setSelection([
      { kind: 'wall', id: wall.id },
      { kind: 'wall', id: scenario().walls[1]!.id },
    ])
    render(<Inspector />)

    expect(button('Dupliser')).toBeDisabled()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(button('← Oversikt'))
    expect(s().selection).toHaveLength(0)
  })
})
