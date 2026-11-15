// @vitest-environment jsdom
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyScenario, type CustomFurniture, type Project } from '@romslig/shared'
import { FURNITURE_DND_TYPE } from '../dnd.ts'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { FurnitureCatalog, FurnitureList, FurnitureProps } from './FurniturePanel.tsx'

const OWN: CustomFurniture = {
  id: 'custom_benk',
  name: 'Snekret benk',
  category: 'gang',
  w: 1.2,
  d: 0.4,
  h: 0.45,
  clearance: { front: 0, back: 0, sides: 0 },
  shape: 'box',
  color: '#a3a3a3',
  nameEn: '',
  description: '',
}

function newProject(): Project {
  const scenario = emptyScenario()
  return {
    id: 'p_test',
    name: 'Test',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: true },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    chat: [],
    customFurniture: [OWN],
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const s = () => useStore.getState()
const scenario = () => activeScenario(s().project!)

/** A 4 × 3 m bedroom at the origin and a 6 × 4 m living room beside it. */
function rooms() {
  const box = (x: number, w: number, h: number) => {
    s().addWall({ x, y: 0 }, { x: x + w, y: 0 })
    s().addWall({ x: x + w, y: 0 }, { x: x + w, y: h })
    s().addWall({ x: x + w, y: h }, { x, y: h })
    s().addWall({ x, y: h }, { x, y: 0 })
  }
  box(0, 4, 3)
  box(10, 6, 4)
  s().detectRooms()
  const [small, big] = [...scenario().rooms].sort((a, b) => a.polygon[0]!.x - b.polygon[0]!.x)
  s().updateRoom(small!.id, { type: 'soverom', name: 'Soverom' })
  s().updateRoom(big!.id, { type: 'stue', name: 'Stue' })
  return { bedroom: small!.id, living: big!.id }
}

// FurnitureProps takes the item as a prop; this reads it from the store so edits show up.
function Props() {
  const item = useStore((st) => activeScenario(st.project!).furniture[0])
  return item ? <FurnitureProps item={item} /> : null
}

const cmField = (name: string) => screen.getByRole('spinbutton', { name: new RegExp(`^${name}`) })
const catalogButton = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  s().load(newProject())
  resetHistory()
})

describe('FurnitureCatalog', () => {
  it('lists the project’s own furniture first, and filters by search and category', () => {
    render(<FurnitureCatalog />)

    const first = within(screen.getByRole('list')).getAllByRole('button')[0]!
    expect(first).toHaveTextContent('Snekret benkeget')
    expect(first).toHaveTextContent('120×40×45 cm')

    fireEvent.change(screen.getByPlaceholderText('Søk…'), { target: { value: 'DOBBELTSENG' } })
    expect(
      within(screen.getByRole('list'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(expect.arrayContaining([expect.stringContaining('Dobbeltseng 180')]))
    expect(screen.queryByRole('button', { name: /Snekret benk/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Søk…'), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gang' } })
    expect(catalogButton(/Snekret benk/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dobbeltseng 180/ })).not.toBeInTheDocument()
  })

  it('puts a clicked bed in the bedroom', () => {
    const { bedroom } = rooms()
    render(<FurnitureCatalog />)

    fireEvent.click(catalogButton(/Dobbeltseng 160/))

    const bed = scenario().furniture[0]!
    expect(bed.catalogId).toBe('seng-160')
    expect(bed.roomId).toBe(bedroom)
  })

  it('falls back to the middle of the room when there is no free spot in it', () => {
    s().addWall({ x: 0, y: 0 }, { x: 1, y: 0 })
    s().addWall({ x: 1, y: 0 }, { x: 1, y: 1 })
    s().addWall({ x: 1, y: 1 }, { x: 0, y: 1 })
    s().addWall({ x: 0, y: 1 }, { x: 0, y: 0 })
    s().detectRooms()
    render(<FurnitureCatalog />)

    fireEvent.click(catalogButton(/Dobbeltseng 180/))

    expect(scenario().furniture[0]).toMatchObject({ x: expect.closeTo(0.5), y: expect.closeTo(0.5) })
  })

  it('without rooms, uses the middle of the walls, or (2, 2) on an empty plan', () => {
    render(<FurnitureCatalog />)
    fireEvent.click(catalogButton(/Snekret benk/))
    expect(scenario().furniture[0]).toMatchObject({ x: 2, y: 2 })

    s().addWall({ x: 0, y: 0 }, { x: 8, y: 0 })
    fireEvent.click(catalogButton(/Snekret benk/))
    expect(scenario().furniture[1]).toMatchObject({ x: 4, y: 0 })
  })

  it('hands the catalog id to a drag', () => {
    render(<FurnitureCatalog />)
    const button = catalogButton(/Snekret benk/)
    const data = new Map<string, string>()
    const drag = createEvent.dragStart(button)
    Object.defineProperty(drag, 'dataTransfer', {
      value: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' },
    })
    fireEvent(button, drag)
    expect(data.get(FURNITURE_DND_TYPE)).toBe('custom_benk')
  })
})

describe('FurnitureList', () => {
  it('says when there is no furniture', () => {
    render(<FurnitureList />)
    expect(screen.getByText('Ingen møbler ennå.')).toBeInTheDocument()
  })

  it('marks problems, filters by room and selects on click', () => {
    const { living } = rooms()
    s().addFurniture('seng-180', { x: 2, y: 1.5 }, { snap: false })
    s().addFurniture('seng-180', { x: 2.2, y: 1.5 }, { snap: false })
    s().addFurniture('lenestol', { x: 13, y: 2 }, { snap: false })
    const view = render(<FurnitureList />)

    expect(screen.getByText(/av 3 møbler har problemer/)).toBeInTheDocument()
    expect(screen.getAllByText('⚠').length).toBeGreaterThan(0)
    expect(screen.getAllByText('✓').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('Lenestol'))
    expect(s().selection).toEqual([{ kind: 'furniture', id: scenario().furniture[2]!.id }])

    view.unmount()
    render(<FurnitureList roomId={living} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('FurnitureProps', () => {
  it('edits the name, size and rotation, and resets the size', () => {
    rooms()
    s().addFurniture('seng-180', { x: 2, y: 1.5 }, { snap: false })
    render(<Props />)

    expect(screen.getByText('Dobbeltseng 180')).toBeInTheDocument()
    expect(screen.getByText(/· Soverom$/)).toBeInTheDocument()
    expect(screen.getByText(/Trenger fri plass:/)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Navn' }), { target: { value: 'Vår seng' } })
    expect(scenario().furniture[0]!.label).toBe('Vår seng')
    fireEvent.change(screen.getByRole('textbox', { name: 'Navn' }), { target: { value: '' } })
    expect(scenario().furniture[0]!.label).toBeNull()

    fireEvent.change(cmField('Bredde'), { target: { value: '160' } })
    expect(scenario().furniture[0]!.size).toEqual({ w: 1.6, d: 2.1, h: 1 })
    fireEvent.change(cmField('Dybde'), { target: { value: '0' } })
    expect(scenario().furniture[0]!.size!.d).toBeCloseTo(2.1)
    fireEvent.click(screen.getByRole('button', { name: /Tilbakestill til katalogmål/ }))
    expect(scenario().furniture[0]!.size).toBeNull()

    fireEvent.change(cmField('Rotasjon'), { target: { value: '-90' } })
    expect(scenario().furniture[0]!.rotation).toBe(270)
    fireEvent.click(screen.getByRole('button', { name: '↻ 90°' }))
    expect(scenario().furniture[0]!.rotation).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '↺ 90°' }))
    expect(scenario().furniture[0]!.rotation).toBe(270)
  })

  it('duplicates, deletes and goes back to the overview', () => {
    s().addFurniture('lenestol', { x: 2, y: 2 }, { snap: false })
    s().select({ kind: 'furniture', id: scenario().furniture[0]!.id })
    render(<Props />)

    expect(screen.getByText('Ingen problemer')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dupliser' }))
    expect(scenario().furniture).toHaveLength(2)

    act(() => s().select({ kind: 'furniture', id: scenario().furniture[0]!.id }))
    fireEvent.click(screen.getByRole('button', { name: 'Slett' }))
    expect(scenario().furniture).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '← Oversikt' }))
    expect(s().selection).toHaveLength(0)
  })

  it('lists the problems of an item in the way', () => {
    rooms()
    s().addFurniture('seng-180', { x: 2, y: 1.5 }, { snap: false })
    s().addFurniture('seng-180', { x: 2.2, y: 1.5 }, { snap: false })
    render(<Props />)

    expect(within(screen.getByRole('list')).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(screen.queryByText('Ingen problemer')).not.toBeInTheDocument()
  })

  it('offers to propose the project’s own furniture for the catalog', () => {
    s().addFurniture('custom_benk', { x: 2, y: 2 }, { snap: false })
    render(<Props />)

    expect(screen.getByText('eget møbel')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Foreslå det for katalogen/ })).toHaveAttribute(
      'href',
      expect.stringContaining('github.com'),
    )
    expect(screen.queryByText(/Trenger fri plass/)).not.toBeInTheDocument()
  })
})
