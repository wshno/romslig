// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import type Konva from 'konva'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pinchView } from './pinch.ts'
import { TOUCH_DRAG_DISTANCE, useTouchGestures } from './useTouchGestures.ts'

/**
 * The plan's container with a stand-in for the canvas Konva listens on: what reaches `canvas`
 * is what Konva would see. The stage is a stand-in too (jsdom cannot draw a real one).
 */
function setup() {
  const container = document.createElement('div')
  const canvas = document.createElement('div')
  container.appendChild(canvas)
  document.body.appendChild(container)
  const konvaSaw: string[] = []
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart'])
    canvas.addEventListener(type, (e) => konvaSaw.push(`${type}:${(e as PointerEvent).pointerId ?? ''}`))
  let dragDistance = 3
  const stage = {
    container: () => container,
    scaleX: () => 40,
    x: () => 10,
    y: () => 20,
    dragDistance: (d?: number) => {
      if (d !== undefined) dragDistance = d
      return dragDistance
    },
  } as unknown as Konva.Stage
  const setView = vi.fn()
  const hook = renderHook(() => useTouchGestures({ current: container }, { current: stage }, setView))
  const send = (type: string, init: { id: number; x?: number; y?: number; kind?: string; primary?: boolean }) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: init.id,
        pointerType: init.kind ?? 'touch',
        isPrimary: init.primary ?? false,
        clientX: init.x ?? 0,
        clientY: init.y ?? 0,
      }),
    )
  return { container, canvas, konvaSaw, setView, hook, send, dragDistance: () => dragDistance }
}

describe('useTouchGestures', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leaves one finger to Konva, with a drag threshold for a finger', () => {
    const t = setup()
    t.send('pointerdown', { id: 1, x: 50, y: 50, primary: true })
    t.send('pointermove', { id: 1, x: 60, y: 50, primary: true })
    t.send('pointerup', { id: 1, x: 60, y: 50, primary: true })
    expect(t.konvaSaw).toEqual(['pointerdown:1', 'pointermove:1', 'pointerup:1'])
    expect(t.setView).not.toHaveBeenCalled()
    expect(t.dragDistance()).toBe(TOUCH_DRAG_DISTANCE)
    expect(t.hook.result.current.multiTouchRef.current).toBe(false)
  })

  it('leaves the mouse alone, with Konva’s own drag threshold', () => {
    const t = setup()
    t.send('pointerdown', { id: 1, kind: 'mouse', primary: true })
    t.send('pointerdown', { id: 2, kind: 'mouse' })
    t.send('pointermove', { id: 1, kind: 'mouse', x: 30 })
    t.send('pointerup', { id: 1, kind: 'mouse' })
    expect(t.konvaSaw).toEqual(['pointerdown:1', 'pointerdown:2', 'pointermove:1', 'pointerup:1'])
    expect(t.dragDistance()).toBe(3)
    expect(t.hook.result.current.lastPointerTypeRef.current).toBe('mouse')
  })

  it('pinches: zooms around the fingers and keeps the gesture from Konva until all fingers are up', () => {
    const t = setup()
    t.send('pointerdown', { id: 1, x: 100, y: 100, primary: true })
    t.send('pointerdown', { id: 2, x: 200, y: 100 })
    expect(t.hook.result.current.multiTouchRef.current).toBe(true)
    // The second finger's touchstart is held back too, so Konva starts no drag for it
    t.canvas.dispatchEvent(new Event('touchstart', { bubbles: true }))

    t.send('pointermove', { id: 2, x: 300, y: 100 })
    const view = { scale: 40, x: 10, y: 20 }
    expect(t.setView).toHaveBeenLastCalledWith(
      pinchView(
        view,
        [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
        [
          { x: 100, y: 100 },
          { x: 300, y: 100 },
        ],
      ),
    )
    expect(t.setView.mock.lastCall![0].scale).toBeCloseTo(80, 9)

    // Neither the first finger's release nor the second's reaches Konva: no tap, no point placed
    t.send('pointerup', { id: 1, x: 100, y: 100 })
    t.send('pointermove', { id: 2, x: 320, y: 100 })
    t.send('pointerup', { id: 2, x: 320, y: 100 })
    expect(t.konvaSaw).toEqual(['pointerdown:1'])
    // After the first finger let go the remaining one no longer zooms
    expect(t.setView).toHaveBeenCalledTimes(1)

    // The next gesture starts afresh
    t.send('pointerdown', { id: 3, x: 10, y: 10, primary: true })
    expect(t.hook.result.current.multiTouchRef.current).toBe(false)
    t.send('pointerup', { id: 3, x: 10, y: 10, primary: true })
    expect(t.konvaSaw).toEqual(['pointerdown:1', 'pointerdown:3', 'pointerup:3'])
  })

  it('treats a cancelled finger like a lifted one', () => {
    const t = setup()
    t.send('pointerdown', { id: 1, x: 0, y: 0, primary: true })
    t.send('pointerdown', { id: 2, x: 100, y: 0 })
    t.send('pointercancel', { id: 1 })
    t.send('pointercancel', { id: 2 })
    expect(t.konvaSaw).toEqual(['pointerdown:1'])
  })

  it('forgets a finger whose release it never saw', () => {
    const t = setup()
    t.send('pointerdown', { id: 1, x: 0, y: 0, primary: true })
    // No pointerup for 1: the next primary press is a new one-finger gesture, not a pinch
    t.send('pointerdown', { id: 2, x: 50, y: 0, primary: true })
    t.send('pointerup', { id: 2, x: 50, y: 0, primary: true })
    expect(t.konvaSaw).toEqual(['pointerdown:1', 'pointerdown:2', 'pointerup:2'])
    expect(t.setView).not.toHaveBeenCalled()
  })

  it('stops listening when unmounted', () => {
    const t = setup()
    t.hook.unmount()
    t.send('pointerdown', { id: 1, primary: true })
    t.send('pointerdown', { id: 2 })
    expect(t.konvaSaw).toEqual(['pointerdown:1', 'pointerdown:2'])
  })
})
