import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLAN_IMAGE_PREFS,
  loadPlanImagePrefs,
  planImageKey,
  savePlanImagePrefs,
  type PrefsStorage,
} from './planImagePrefs.ts'

function memoryStorage(): PrefsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

const failing: PrefsStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('plan image prefs', () => {
  it('defaults to a visible plan at 0.6 when nothing is stored', () => {
    expect(loadPlanImagePrefs('p_1', memoryStorage())).toEqual({ visible: true, opacity: 0.6 })
    expect(loadPlanImagePrefs('p_1', null)).toEqual(DEFAULT_PLAN_IMAGE_PREFS)
  })

  it('remembers visibility and opacity per project', () => {
    const storage = memoryStorage()
    savePlanImagePrefs('p_1', { visible: false, opacity: 0.3 }, storage)
    expect(storage.data.has(planImageKey('p_1'))).toBe(true)
    expect(planImageKey('p_1')).toBe('romslig:plan-image:p_1')
    expect(loadPlanImagePrefs('p_1', storage)).toEqual({ visible: false, opacity: 0.3 })
    expect(loadPlanImagePrefs('p_2', storage)).toEqual(DEFAULT_PLAN_IMAGE_PREFS)
  })

  it('falls back to the defaults when storage throws', () => {
    expect(() => savePlanImagePrefs('p_1', { visible: false, opacity: 0.2 }, failing)).not.toThrow()
    expect(loadPlanImagePrefs('p_1', failing)).toEqual(DEFAULT_PLAN_IMAGE_PREFS)
  })

  it('ignores malformed values', () => {
    const storage = memoryStorage()
    storage.setItem(planImageKey('a'), '{not json')
    storage.setItem(planImageKey('b'), JSON.stringify({ visible: 'no', opacity: 'x' }))
    storage.setItem(planImageKey('c'), JSON.stringify({ visible: false, opacity: 7 }))
    storage.setItem(planImageKey('d'), 'null')
    expect(loadPlanImagePrefs('a', storage)).toEqual(DEFAULT_PLAN_IMAGE_PREFS)
    expect(loadPlanImagePrefs('b', storage)).toEqual(DEFAULT_PLAN_IMAGE_PREFS)
    expect(loadPlanImagePrefs('c', storage)).toEqual({ visible: false, opacity: 1 })
    expect(loadPlanImagePrefs('d', storage)).toEqual(DEFAULT_PLAN_IMAGE_PREFS)
  })
})
