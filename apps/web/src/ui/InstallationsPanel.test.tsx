// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyScenario, type Project } from '@romslig/shared'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { CeilingProps, FixtureProps, InstallationsOverview, RunProps } from './InstallationsPanel.tsx'

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
    customFurniture: [],
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const s = () => useStore.getState()
const scenario = () => activeScenario(s().project!)

function room() {
  s().addWall({ x: 0, y: 0 }, { x: 4, y: 0 })
  s().addWall({ x: 4, y: 0 }, { x: 4, y: 3 })
  s().addWall({ x: 4, y: 3 }, { x: 0, y: 3 })
  s().addWall({ x: 0, y: 3 }, { x: 0, y: 0 })
  s().detectRooms()
}

// The panels take the item as a prop; these read it from the store so edits show up.
function Fixture() {
  const fx = useStore((st) => activeScenario(st.project!).fixtures[0])
  return fx ? <FixtureProps fx={fx} /> : null
}
function RunPanel() {
  const run = useStore((st) => activeScenario(st.project!).runs[0])
  return run ? <RunProps run={run} /> : null
}
function Ceiling() {
  const c = useStore((st) => activeScenario(st.project!).loweredCeilings[0])
  return c ? <CeilingProps ceiling={c} /> : null
}

const field = (name: string) => screen.getByRole('textbox', { name })
const number = (name: string) => screen.getByRole('spinbutton', { name: new RegExp(`^${name}`) })

beforeEach(() => {
  s().load(newProject())
  resetHistory()
})

describe('FixtureProps', () => {
  it('shows the room and edits kind, height, name and note', () => {
    room()
    s().addFixture('outlet', { x: 1, y: 0.1 }, scenario().walls[0]!.id)
    render(<Fixture />)

    expect(screen.getByRole('heading', { name: 'Stikkontakt' })).toBeInTheDocument()
    expect(screen.getByText(/· på vegg/)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'switch' } })
    fireEvent.change(number('Høyde over gulv'), { target: { value: '-5' } })
    fireEvent.change(field('Navn'), { target: { value: 'Ved døra' } })
    fireEvent.change(field('Notat'), { target: { value: 'dimmer' } })

    expect(scenario().fixtures[0]).toMatchObject({ kind: 'switch', z: 0, label: 'Ved døra', note: 'dimmer' })
    fireEvent.change(field('Navn'), { target: { value: '' } })
    expect(scenario().fixtures[0]!.label).toBeNull()
  })

  it('says when the fixture is outside every room, and the header deletes it', () => {
    s().addFixture('drain', { x: 20, y: 20 }, null)
    s().select({ kind: 'fixture', id: scenario().fixtures[0]!.id })
    render(<Fixture />)

    expect(screen.getByText('Utenfor rommene (f.eks. i trappeoppgangen)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Slett' }))
    expect(scenario().fixtures).toHaveLength(0)
  })
})

describe('RunProps', () => {
  it('edits kind, placement, height, diameter and texts', () => {
    s().addRun([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ])
    s().select({ kind: 'run', id: scenario().runs[0]!.id })
    render(<RunPanel />)

    expect(screen.getByText('Lengde 7,00 m · 3 punkter')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'drain' } })
    expect(scenario().runs[0]).toMatchObject({ kind: 'drain', diameter: 0.11 })

    fireEvent.change(screen.getByRole('combobox', { name: 'Ligger' }), { target: { value: 'ceiling' } })
    expect(scenario().runs[0]!.placement).toBe('ceiling')

    fireEvent.change(number('Diameter'), { target: { value: '50' } })
    expect(scenario().runs[0]!.diameter).toBeCloseTo(0.05)
    fireEvent.change(number('Diameter'), { target: { value: '0' } })
    expect(scenario().runs[0]!.diameter).toBeCloseTo(0.05)

    fireEvent.change(number('Høyde over gulv'), { target: { value: '120' } })
    expect(scenario().runs[0]!.z).toBeCloseTo(1.2)
    fireEvent.change(field('Notat'), { target: { value: 'i kasse' } })
    expect(scenario().runs[0]!.note).toBe('i kasse')

    fireEvent.click(screen.getByRole('button', { name: '← Oversikt' }))
    expect(s().selection).toHaveLength(0)
  })
})

describe('CeilingProps', () => {
  it('keeps the height at 1.5 m or more and has no note', () => {
    s().addLoweredCeiling([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ])
    render(<Ceiling />)

    expect(screen.getByText('Areal 2,0 m²')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Notat' })).not.toBeInTheDocument()
    fireEvent.change(number('Høyde under'), { target: { value: '100' } })
    expect(scenario().loweredCeilings[0]!.height).toBe(1.5)
    fireEvent.change(field('Navn'), { target: { value: 'Innkassing' } })
    expect(scenario().loweredCeilings[0]!.label).toBe('Innkassing')
  })
})

describe('InstallationsOverview', () => {
  it('explains the tools while there is nothing', () => {
    render(<InstallationsOverview />)
    expect(screen.getByText(/Legg inn stikkontakter/)).toBeInTheDocument()
    expect(screen.queryByText(/Ikke lagt inn/)).not.toBeInTheDocument()
  })

  it('lists the key fixtures, counts the rest and points out what is missing', () => {
    room()
    s().addFixture('main_valve', { x: 1, y: 1 }, null)
    s().addFixture('outlet', { x: 1, y: 0.1 }, null)
    s().addFixture('outlet', { x: 2, y: 0.1 }, null)
    s().addRun([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
    s().addLoweredCeiling([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ])
    render(<InstallationsOverview />)

    expect(screen.getByText('Hovedkran (stoppekran)')).toBeInTheDocument()
    expect(screen.getByText('2 × stikkontakt, 1 føring, 1 nedforet tak')).toBeInTheDocument()
    expect(screen.getByText(/Ikke lagt inn: sikringsskap\./)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Hovedkran (stoppekran)'))
    expect(s().selection).toEqual([{ kind: 'fixture', id: scenario().fixtures[0]!.id }])
    fireEvent.click(screen.getByRole('button', { name: 'Legg til' }))
    expect(s().tool).toBe('fixture')
  })

  it('counts several runs, and a key fixture outside the rooms', () => {
    s().addFixture('fuse_box', { x: 9, y: 9 }, null)
    s().addRun([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
    s().addRun([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ])
    render(<InstallationsOverview />)

    expect(screen.getByText('utenfor')).toBeInTheDocument()
    expect(screen.getByText('2 føringer')).toBeInTheDocument()
    expect(screen.getByText(/Ikke lagt inn: hovedkran \(stoppekran\)\./)).toBeInTheDocument()
  })
})
