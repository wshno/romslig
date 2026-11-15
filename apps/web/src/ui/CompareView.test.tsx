// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyScenario, type Project } from '@romslig/shared'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { CompareView } from './CompareView.tsx'

// Konva needs a real canvas; the panes are stood in for by their titles.
vi.mock('../editor2d/Plan2D.tsx', () => ({
  Plan2D: ({ title }: { title: string }) => <section aria-label={title} />,
}))

function newProject(): Project {
  const scenario = emptyScenario()
  return {
    id: 'p_test',
    name: 'Test',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: true },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [{ ...scenario, name: 'Nå' }],
    activeScenarioId: scenario.id,
    chat: [],
    customFurniture: [],
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const s = () => useStore.getState()
const scenario = () => activeScenario(s().project!)

/** "Nå": two 3 × 3 m rooms side by side with a sofa. "Forslag": the wall between them gone, more furniture. */
function twoVariants() {
  s().load(newProject())
  resetHistory()
  s().addWall({ x: 0, y: 0 }, { x: 3, y: 0 })
  s().addWall({ x: 3, y: 0 }, { x: 6, y: 0 })
  s().addWall({ x: 6, y: 0 }, { x: 6, y: 3 })
  s().addWall({ x: 6, y: 3 }, { x: 3, y: 3 })
  s().addWall({ x: 3, y: 3 }, { x: 0, y: 3 })
  s().addWall({ x: 0, y: 3 }, { x: 0, y: 0 })
  const middle = s().addWall({ x: 3, y: 0 }, { x: 3, y: 3 })
  s().detectRooms()
  s().addFurniture('sofa-3', { x: 1.5, y: 1.5 }, { snap: false })
  s().addFurniture('lenestol', { x: 4.5, y: 1.5 }, { snap: false })
  const before = scenario().id

  s().duplicateScenario('Forslag')
  s().select({ kind: 'wall', id: middle.id })
  s().deleteSelected()
  s().detectRooms()
  s().addFurniture('spisestol', { x: 1, y: 1 }, { snap: false })
  s().addFurniture('spisestol', { x: 2, y: 1 }, { snap: false })
  const lenestol = scenario().furniture.find((f) => f.catalogId === 'lenestol')!
  s().select({ kind: 'furniture', id: lenestol.id })
  s().deleteSelected()
  const sofa = scenario().furniture.find((f) => f.catalogId === 'sofa-3')!
  s().updateFurniture(sofa.id, { x: 2, y: 2 })
  s().select(null)
  return { before, after: scenario().id }
}

describe('CompareView', () => {
  beforeEach(() => {
    s().load(newProject())
  })

  it('compares the variant with the one it came from', () => {
    twoVariants()
    render(<CompareView />)

    expect(screen.getByRole('region', { name: 'Før: Nå' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Etter: Forslag' })).toBeInTheDocument()
    expect(screen.getByText('1 vegg fjernet')).toHaveClass('rm')
    expect(screen.getByText(/ukjent om en fjernet eller flyttet vegg er bærende/)).toBeInTheDocument()
    expect(screen.getByText(/Lagt til: 2 × Spisestol/)).toHaveClass('add')
    expect(screen.getByText(/Fjernet: Lenestol/)).toHaveClass('rm')
    expect(screen.getByText(/Flyttet: Sofa/)).toBeInTheDocument()
    expect(screen.getByText(/slått sammen\/borte/)).toHaveClass('rm')
    expect(screen.getByText(/^Sum: \d+,\d m² → \d+,\d m²$/)).toBeInTheDocument()
    expect(screen.getByText(/Møbler med problemer:/)).toBeInTheDocument()
  })

  it('swaps before and after, and says when both are the same variant', () => {
    twoVariants()
    render(<CompareView />)

    fireEvent.click(screen.getByTitle('Bytt om'))
    expect(screen.getByRole('region', { name: 'Før: Forslag' })).toBeInTheDocument()
    expect(screen.getByText('1 ny vegg')).toHaveClass('add')

    const [beforePicker, afterPicker] = screen.getAllByRole('combobox')
    fireEvent.change(beforePicker!, { target: { value: (afterPicker as HTMLSelectElement).value } })
    expect(screen.getByText('Velg to forskjellige varianter for å se forskjellene.')).toBeInTheDocument()
  })

  it('reports nothing changed between two copies', () => {
    s().load(newProject())
    s().duplicateScenario('Kopi')
    render(<CompareView />)

    const building = screen.getByRole('heading', { name: 'Vegger, åpninger og installasjoner' })
    expect(within(building.parentElement!).getByText('Uendret.')).toBeInTheDocument()
    expect(screen.getAllByText('Uendret.')).toHaveLength(3)
  })

  it('goes back to work in the after variant', () => {
    const { before, after } = twoVariants()
    s().setActiveScenario(before)
    render(<CompareView />)

    const [, afterPicker] = screen.getAllByRole('combobox')
    fireEvent.change(afterPicker!, { target: { value: after } })
    fireEvent.click(screen.getByRole('button', { name: 'Jobb videre i «Forslag»' }))

    expect(s().project!.activeScenarioId).toBe(after)
    expect(s().view).toBe('split')
  })
})
