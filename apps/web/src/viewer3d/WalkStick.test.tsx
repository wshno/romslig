// @vitest-environment jsdom
import { createRef, type RefObject } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WalkStick } from './WalkStick.tsx'
import { STANDING, WALK_SPEED, type WalkInput } from './walkMotion.ts'

/** The stick, laid out as a 120px circle with its middle at (100, 500); jsdom lays nothing out. */
function renderStick() {
  const stickRef = createRef<WalkInput>() as RefObject<WalkInput>
  stickRef.current = STANDING
  const view = render(<WalkStick stickRef={stickRef} />)
  const stick = screen.getByRole('group', { name: 'Styrespak for å gå' })
  stick.getBoundingClientRect = () => new DOMRect(40, 440, 120, 120)
  const knob = stick.querySelector<HTMLElement>('.walk-stick-knob')!
  return { stickRef, stick, knob, view }
}

describe('WalkStick', () => {
  it('walks forward while the thumb pushes it up, and stops when the thumb lets go', () => {
    const { stickRef, stick, knob } = renderStick()
    fireEvent.pointerDown(stick, { pointerId: 7, clientX: 100, clientY: 500 })
    expect(stickRef.current).toEqual(STANDING)
    fireEvent.pointerMove(stick, { pointerId: 7, clientX: 100, clientY: 440 })
    expect(stickRef.current.forward).toBeCloseTo(1)
    expect(stickRef.current.right).toBeCloseTo(0)
    expect(stickRef.current.speed).toBe(WALK_SPEED)
    expect(knob.style.transform).toBe('translate(0px, -60px)')
    fireEvent.pointerUp(stick, { pointerId: 7, clientX: 100, clientY: 440 })
    expect(stickRef.current).toEqual(STANDING)
    expect(knob.style.transform).toBe('')
  })

  it('follows only the thumb that took it', () => {
    const { stickRef, stick } = renderStick()
    fireEvent.pointerDown(stick, { pointerId: 1, clientX: 160, clientY: 500 })
    expect(stickRef.current.right).toBeCloseTo(1)
    // A second finger neither steers nor lets go of the stick
    fireEvent.pointerDown(stick, { pointerId: 2, clientX: 100, clientY: 560 })
    fireEvent.pointerMove(stick, { pointerId: 2, clientX: 100, clientY: 560 })
    fireEvent.pointerUp(stick, { pointerId: 2 })
    expect(stickRef.current.right).toBeCloseTo(1)
    fireEvent.pointerCancel(stick, { pointerId: 1 })
    expect(stickRef.current).toEqual(STANDING)
  })

  it('stops the walk when it goes away with the thumb still down', () => {
    const { stickRef, stick, view } = renderStick()
    fireEvent.pointerDown(stick, { pointerId: 1, clientX: 100, clientY: 440 })
    expect(stickRef.current.forward).toBeGreaterThan(0)
    view.unmount()
    expect(stickRef.current).toEqual(STANDING)
  })
})
