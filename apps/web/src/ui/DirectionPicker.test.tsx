// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyScenario, type Project } from '@romslig/shared'
import { activeScenario, resetHistory, useStore } from '../store.ts'
import { DirectionPicker } from './DirectionPicker.tsx'

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

/** A 4 × 3 m room with a window in the top wall and a door in a wall outside it. */
function setup() {
  const s = useStore.getState()
  s.load(newProject())
  resetHistory()
  const top = s.addWall({ x: 0, y: 0 }, { x: 4, y: 0 })
  s.addWall({ x: 4, y: 0 }, { x: 4, y: 3 })
  s.addWall({ x: 4, y: 3 }, { x: 0, y: 3 })
  s.addWall({ x: 0, y: 3 }, { x: 0, y: 0 })
  const far = s.addWall({ x: 10, y: 0 }, { x: 14, y: 0 })
  s.detectRooms()
  s.addOpening('window', top.id, 2)
  s.addOpening('door', far.id, 2)
  const scenario = activeScenario(useStore.getState().project!)
  return { scenario, room: scenario.rooms[0]! }
}

// The walls are SVG lines with no accessible role, so they are found by their class.
const edges = (view: ReturnType<typeof render>) => [...view.container.querySelectorAll('g.edge')]

describe('DirectionPicker', () => {
  beforeEach(() => {
    useStore.getState().load(newProject())
  })

  it('asks for a wall until one is chosen, and reports the clicked side', () => {
    const { scenario, room } = setup()
    const onChange = vi.fn()
    const view = render(<DirectionPicker scenario={scenario} room={room} value={null} onChange={onChange} />)

    expect(screen.getByRole('group', { name: 'Velg veggen du ser mot' })).toBeInTheDocument()
    expect(screen.getByText('Velg veggen du så mot')).toHaveClass('muted')
    const walls = edges(view)
    expect(walls).toHaveLength(4)

    fireEvent.click(walls[0]!)
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^(top|bottom|left|right)$/))
  })

  it.each(['top', 'bottom', 'left', 'right'] as const)(
    'shows the camera facing %s, and a second click clears it',
    (side) => {
      const { scenario, room } = setup()
      const onChange = vi.fn()
      const view = render(<DirectionPicker scenario={scenario} room={room} value={side} onChange={onChange} />)

      expect(screen.getByText(/^Ser mot veggen /)).not.toHaveClass('muted')
      for (const wall of edges(view)) fireEvent.click(wall)
      expect(onChange).toHaveBeenCalledWith(null)
    },
  )
})
