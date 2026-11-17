// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HIT, handleHitStroke, hitSizes, useCoarsePointer, useHitSizes } from './hit.ts'

/** A matchMedia stand-in (jsdom has none) whose '(pointer: coarse)' answer can be changed. */
function stubMatchMedia(coarse: boolean) {
  const listeners = new Set<() => void>()
  const mql = {
    get matches() {
      return coarse
    },
    media: '(pointer: coarse)',
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => (q === '(pointer: coarse)' ? mql : { ...mql, matches: false })),
  )
  return {
    listeners,
    set(next: boolean) {
      coarse = next
      listeners.forEach((l) => l())
    },
  }
}

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

describe('useCoarsePointer', () => {
  it('is false without matchMedia (jsdom, node)', () => {
    expect(typeof window.matchMedia).toBe('undefined')
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
    expect(renderHook(() => useHitSizes()).result.current).toBe(HIT.fine)
  })

  it('follows (pointer: coarse), also when it changes', () => {
    const media = stubMatchMedia(true)
    const { result, unmount } = renderHook(() => useHitSizes())
    expect(result.current).toBe(HIT.coarse)

    act(() => media.set(false))
    expect(result.current).toBe(HIT.fine)
    act(() => media.set(true))
    expect(result.current).toBe(HIT.coarse)

    unmount()
    expect(media.listeners.size).toBe(0)
  })
})
