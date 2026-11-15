// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { emptyScenario, type Project } from '@romslig/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { describeIssue, useFurnitureIssues, useHistory, useTypingAsOneUndoStep } from './hooks.ts'
import { activeScenario, resetHistory, undo, useStore } from './store.ts'

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
const steps = () => useStore.temporal.getState().pastStates.length

beforeEach(() => {
  state().load(newProject())
  resetHistory()
})

describe('useFurnitureIssues', () => {
  it('is empty without a project, and lists the problems of overlapping furniture', () => {
    useStore.setState({ project: null })
    const { result, rerender } = renderHook(() => useFurnitureIssues())
    expect(result.current.size).toBe(0)

    act(() => {
      state().load(newProject())
      state().addFurniture('sofa-3', { x: 2, y: 2 }, { snap: false })
      state().addFurniture('sofa-3', { x: 2, y: 2 }, { snap: false })
    })
    rerender()

    expect(result.current.size).toBe(2)
    const scenario = activeScenario(state().project!)
    const [first] = scenario.furniture
    const [issue] = result.current.get(first!.id)!
    expect(describeIssue(issue!, scenario, first!.catalogId)).toMatch(/\S/)
  })
})

describe('useHistory', () => {
  it('follows what can be undone and redone', () => {
    const { result } = renderHook(() => useHistory())
    expect(result.current).toEqual({ canUndo: false, canRedo: false })

    act(() => {
      state().addWall({ x: 0, y: 0 }, { x: 1, y: 0 })
    })
    expect(result.current).toEqual({ canUndo: true, canRedo: false })

    act(() => undo())
    expect(result.current).toEqual({ canUndo: false, canRedo: true })
  })
})

describe('useTypingAsOneUndoStep', () => {
  function Form() {
    const typing = useTypingAsOneUndoStep()
    const project = useStore((s) => s.project)
    return (
      <div {...typing}>
        <input
          aria-label="Navn"
          value={project?.name ?? ''}
          onChange={(e) => state().updateProject((p) => ({ ...p, name: e.target.value }))}
        />
        <input
          aria-label="Bærende"
          type="checkbox"
          checked={activeScenario(project!).walls.length > 0}
          onChange={() => state().addWall({ x: 0, y: 0 }, { x: 1, y: 0 })}
        />
      </div>
    )
  }

  it('makes everything typed into one field a single step, until Enter or leaving the field', () => {
    render(<Form />)
    const name = screen.getByRole('textbox', { name: 'Navn' })

    fireEvent.change(name, { target: { value: 'K' } })
    fireEvent.change(name, { target: { value: 'Kj' } })
    fireEvent.change(name, { target: { value: 'Kjø' } })
    expect(steps()).toBe(1)

    fireEvent.keyDown(name, { key: 'Enter' })
    fireEvent.change(name, { target: { value: 'Kjøkken' } })
    expect(steps()).toBe(2)

    fireEvent.blur(name)
    fireEvent.change(name, { target: { value: 'Kjøkkenet' } })
    expect(steps()).toBe(3)
    fireEvent.keyDown(name, { key: 'a' })
  })

  it('leaves fields that are not typed in alone', () => {
    render(<Form />)
    const box = screen.getByRole('checkbox', { name: 'Bærende' })
    fireEvent.click(box)
    expect(steps()).toBe(1)
  })
})
