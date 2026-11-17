// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COARSE_QUERY, COMPACT_QUERY, NARROW_QUERY, useCoarsePointer, useIsCompact, useIsNarrow } from './device.ts'
import { stubMatchMedia } from './test/matchMedia.ts'

describe('device', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is wide and fine-pointed where there is no matchMedia (jsdom, old browsers)', () => {
    expect(renderHook(() => useIsNarrow()).result.current).toBe(false)
    expect(renderHook(() => useCoarsePointer()).result.current).toBe(false)
  })

  it('follows the width, and changes when the window does', () => {
    const media = stubMatchMedia({ [NARROW_QUERY]: true })
    const { result, unmount } = renderHook(() => useIsNarrow())
    expect(result.current).toBe(true)

    media.set(NARROW_QUERY, false)
    expect(result.current).toBe(false)
    media.set(NARROW_QUERY, true)
    expect(result.current).toBe(true)

    unmount()
    expect(media.listening(NARROW_QUERY)).toBe(0)
  })

  it('tells a tablet-wide window (compact) from a phone-wide one (narrow)', () => {
    const media = stubMatchMedia({ [COMPACT_QUERY]: true, [NARROW_QUERY]: false })
    const { result } = renderHook(() => [useIsCompact(), useIsNarrow()])
    expect(result.current).toEqual([true, false])
    media.set(COMPACT_QUERY, false)
    expect(result.current).toEqual([false, false])
  })

  it('follows the pointer on its own: a wide touch tablet is coarse, a narrow desktop window is not', () => {
    const media = stubMatchMedia({ [COARSE_QUERY]: true })
    expect(renderHook(() => useCoarsePointer()).result.current).toBe(true)
    expect(renderHook(() => useIsNarrow()).result.current).toBe(false)

    media.set(COARSE_QUERY, false)
    media.set(NARROW_QUERY, true)
    expect(renderHook(() => useCoarsePointer()).result.current).toBe(false)
    expect(renderHook(() => useIsNarrow()).result.current).toBe(true)
  })
})
