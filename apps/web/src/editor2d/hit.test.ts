// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COARSE_QUERY, NARROW_QUERY } from '../device.ts'
import { stubMatchMedia } from '../test/matchMedia.ts'
import { HIT, handleHitStroke, hitSizes, useHitSizes } from './hit.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hit sizes', () => {
  it('keeps the desktop sizes the plan always had for a fine pointer', () => {
    expect(hitSizes(false)).toBe(HIT.fine)
    expect(HIT.fine).toMatchObject({ handle: 6, handleHit: 6, vertex: 5, wall: 8, line: 10, snap: 12 })
  })

  it('grows what a finger presses or snaps to on a coarse pointer', () => {
    const c = hitSizes(true)
    expect(c.coarse).toBe(true)
    expect(c.handleHit).toBe(14)
    expect(c.wall).toBe(24)
    expect(c.snap).toBe(20)
    // Drawn bigger too, not only caught further out
    expect(c.handle).toBeGreaterThan(HIT.fine.handle)
    expect(c.vertex).toBeGreaterThan(HIT.fine.vertex)
    for (const k of ['handle', 'handleHit', 'vertex', 'wall', 'line', 'snap'] as const)
      expect(c[k]).toBeGreaterThanOrEqual(HIT.fine[k])
  })

  it('gives a handle a hit stroke that reaches the hit radius, and never less than its 2 px stroke', () => {
    // radius + half the hit stroke = the hit radius
    const coarse = HIT.coarse
    expect(coarse.handle + handleHitStroke(coarse.handle, coarse.handleHit) / 2).toBe(coarse.handleHit)
    // A fine pointer keeps Konva's default (the hit stroke is the 2 px stroke)
    expect(handleHitStroke(HIT.fine.handle, HIT.fine.handleHit)).toBe(2)
    expect(handleHitStroke(5, 5)).toBe(2)
  })
})

// The pointer comes from device.ts, the app's one useCoarsePointer: these check that the plan's
// sizes follow it
describe('useHitSizes', () => {
  it('gives the desktop sizes without matchMedia (jsdom, node)', () => {
    expect(typeof window.matchMedia).toBe('undefined')
    expect(renderHook(() => useHitSizes()).result.current).toBe(HIT.fine)
  })

  it('follows (pointer: coarse), also when it changes, and stops listening when unmounted', () => {
    const media = stubMatchMedia({ [COARSE_QUERY]: true })
    const { result, unmount } = renderHook(() => useHitSizes())
    expect(result.current).toBe(HIT.coarse)

    media.set(COARSE_QUERY, false)
    expect(result.current).toBe(HIT.fine)
    media.set(COARSE_QUERY, true)
    expect(result.current).toBe(HIT.coarse)

    unmount()
    expect(media.listening(COARSE_QUERY)).toBe(0)
  })

  it('does not take a narrow window for a finger: the layout follows the width, the sizes the pointer', () => {
    stubMatchMedia({ [NARROW_QUERY]: true })
    expect(renderHook(() => useHitSizes()).result.current).toBe(HIT.fine)
  })
})
