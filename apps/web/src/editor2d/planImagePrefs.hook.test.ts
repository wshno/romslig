// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLAN_IMAGE_PREFS, loadPlanImagePrefs, planImageKey, savePlanImagePrefs } from './planImagePrefs.ts'

// The hook shares one in-memory copy per project across the page, so each test loads it afresh.
async function load() {
  vi.resetModules()
  return import('./planImagePrefs.ts')
}

describe('usePlanImagePrefs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts from what is stored, and remembers a change', async () => {
    localStorage.setItem(planImageKey('p_1'), JSON.stringify({ visible: false, opacity: 0.3 }))
    const { usePlanImagePrefs } = await load()
    const { result } = renderHook(() => usePlanImagePrefs('p_1'))
    expect(result.current[0]).toEqual({ visible: false, opacity: 0.3 })

    act(() => result.current[1]({ opacity: 0.9 }))

    expect(result.current[0]).toEqual({ visible: false, opacity: 0.9 })
    expect(JSON.parse(localStorage.getItem(planImageKey('p_1'))!)).toEqual({ visible: false, opacity: 0.9 })
  })

  it('shows a change in one pane in the other at once', async () => {
    const { usePlanImagePrefs } = await load()
    const left = renderHook(() => usePlanImagePrefs('p_2'))
    const right = renderHook(() => usePlanImagePrefs('p_2'))
    expect(right.result.current[0]).toEqual(DEFAULT_PLAN_IMAGE_PREFS)

    act(() => left.result.current[1]({ visible: false }))

    expect(right.result.current[0].visible).toBe(false)
    left.unmount()
    right.unmount()
  })
})

describe('plan image prefs and a blocked browser storage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the defaults and stores nothing when localStorage cannot be reached', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(loadPlanImagePrefs('p_3')).toEqual(DEFAULT_PLAN_IMAGE_PREFS)
    expect(() => savePlanImagePrefs('p_3', { visible: true, opacity: 1 })).not.toThrow()
  })

  it('ignores a full storage', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
    }
    expect(() => savePlanImagePrefs('p_4', { visible: true, opacity: 1 }, storage)).not.toThrow()
  })
})
