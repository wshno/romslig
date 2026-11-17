// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { emptyScenario, type Project } from '@romslig/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { BottomSheet } from './BottomSheet.tsx'

function newProject(): Project {
  const scenario = emptyScenario()
  return {
    id: 'p_sheet',
    name: 'Ark',
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
  }
}

const state = () => useStore.getState()
const handle = () => screen.getByRole('button', { name: /panelet/ })
const sheet = () => screen.getByRole('region', { name: 'Egenskaper' })

/** jsdom lays nothing out: the sizes a 600px tall view would give the sheet and its parts. */
function layOut(view = 600) {
  const el = sheet()
  Object.defineProperty(el.parentElement!, 'clientHeight', { configurable: true, value: view })
  Object.defineProperty(el.querySelector('.sheet-handle')!, 'offsetHeight', { configurable: true, value: 24 })
  Object.defineProperty(el.querySelector('.tabs')!, 'offsetHeight', { configurable: true, value: 40 })
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 64 })
}

function renderSheet() {
  return render(
    <div>
      <BottomSheet label="Egenskaper">
        <aside className="inspector">
          <div className="tabs">
            <button>Oversikt</button>
          </div>
          <p>innhold</p>
        </aside>
      </BottomSheet>
    </div>,
  )
}

describe('BottomSheet', () => {
  beforeEach(() => {
    useStore.setState({ project: newProject(), tool: 'select', selection: [] })
    resetHistory()
  })

  it('starts closed, and a tap on the handle steps it up and back down', () => {
    renderSheet()
    expect(sheet()).toHaveClass('closed')
    expect(handle()).toHaveAttribute('aria-expanded', 'false')
    expect(handle()).toHaveAccessibleName('Vis panelet')
    expect(handle()).toHaveAttribute('aria-controls', screen.getByText('innhold').closest('.sheet-body')!.id)

    fireEvent.click(handle())
    expect(sheet()).toHaveClass('half')
    expect(handle()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(handle())
    expect(sheet()).toHaveClass('full')
    expect(handle()).toHaveAccessibleName('Skjul panelet')
    fireEvent.click(handle())
    expect(sheet()).toHaveClass('closed')
  })

  it('opens when a tab is tapped while it is closed', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Oversikt' }))
    expect(sheet()).toHaveClass('half')
  })

  it('goes to full height when a text area in it gets the focus', () => {
    render(
      <div>
        <BottomSheet label="Egenskaper">
          <aside className="inspector">
            <div className="tabs">
              <button>Assistent</button>
            </div>
            <input aria-label="Navn" />
            <textarea aria-label="Spørsmål" />
          </aside>
        </BottomSheet>
      </div>,
    )
    fireEvent.click(handle())
    act(() => screen.getByRole('textbox', { name: 'Navn' }).focus())
    expect(sheet()).toHaveClass('half')
    act(() => screen.getByRole('textbox', { name: 'Spørsmål' }).focus())
    expect(sheet()).toHaveClass('full')
  })

  it('comes up when something is selected, and goes down for a drawing tool', () => {
    renderSheet()
    act(() => {
      const wall = state().addWall({ x: 0, y: 0 }, { x: 3, y: 0 })
      state().select({ kind: 'wall', id: wall.id })
    })
    expect(sheet()).toHaveClass('half')

    act(() => state().setTool('wall'))
    expect(sheet()).toHaveClass('closed')
  })

  it('goes down when a piece is added from the catalog, but not when it is duplicated', () => {
    renderSheet()
    fireEvent.click(handle())
    fireEvent.click(handle())
    expect(sheet()).toHaveClass('full')

    // What a click in the catalog does: add, then select the new piece
    act(() => state().addFurniture('sofa-3', { x: 2, y: 2 }, { snap: false }))
    expect(sheet()).toHaveClass('closed')
    expect(activeScenario(state().project!).furniture).toHaveLength(1)

    fireEvent.click(handle())
    act(() => state().duplicateSelected())
    expect(activeScenario(state().project!).furniture).toHaveLength(2)
    expect(sheet()).toHaveClass('half')
  })

  it('follows a drag on the handle and lets go at the nearest height', () => {
    renderSheet()
    layOut()
    const h = handle()

    fireEvent.pointerDown(h, { button: 0, pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 300 })
    expect(sheet()).toHaveClass('dragging')
    expect(sheet().style.height).toBe('264px')
    fireEvent.pointerUp(h, { pointerId: 1, clientY: 260 })
    // The click that ends the drag is not a tap
    fireEvent.click(h)
    expect(sheet()).toHaveClass('half')
    expect(sheet()).not.toHaveClass('dragging')
    expect(sheet().style.height).toBe('')

    // Dragged past the top, it stops at full height
    Object.defineProperty(sheet(), 'offsetHeight', { configurable: true, value: 300 })
    fireEvent.pointerDown(h, { button: 0, pointerId: 2, clientY: 300 })
    fireEvent.pointerMove(h, { pointerId: 2, clientY: -400 })
    expect(sheet().style.height).toBe('600px')
    fireEvent.pointerUp(h, { pointerId: 2, clientY: -400 })
    expect(sheet()).toHaveClass('full')
  })

  it('takes a finger that barely moves as a tap', () => {
    renderSheet()
    layOut()
    const h = handle()
    fireEvent.pointerDown(h, { button: 0, pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 497 })
    fireEvent.pointerUp(h, { pointerId: 1, clientY: 497 })
    fireEvent.click(h)
    expect(sheet()).toHaveClass('half')
    expect(sheet()).not.toHaveClass('dragging')
  })
})
