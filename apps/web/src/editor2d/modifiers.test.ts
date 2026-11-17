import { afterEach, describe, expect, it } from 'vitest'
import { NO_MODIFIERS, useStore } from '../store.ts'
import { additive, freeAngle, isAdditive, isFreeAngle, isNoGrid, noGrid } from './modifiers.ts'

const on = { additive: true, freeAngle: true, noGrid: true }

afterEach(() => useStore.setState({ modifiers: NO_MODIFIERS }))

describe('modifier helpers', () => {
  it('give the key alone while the toggles are off, so a mouse and keyboard work as before', () => {
    expect(additive({ shiftKey: true }, NO_MODIFIERS)).toBe(true)
    expect(additive({ shiftKey: false }, NO_MODIFIERS)).toBe(false)
    expect(additive(undefined, NO_MODIFIERS)).toBe(false)
    expect(freeAngle(true, NO_MODIFIERS)).toBe(true)
    expect(freeAngle(false, NO_MODIFIERS)).toBe(false)
    expect(noGrid({ altKey: true }, NO_MODIFIERS)).toBe(true)
    expect(noGrid({ altKey: false, shiftKey: true }, NO_MODIFIERS)).toBe(false)
  })

  it('give the toggle without the key, for a finger', () => {
    expect(additive({ shiftKey: false }, on)).toBe(true)
    expect(freeAngle(false, on)).toBe(true)
    expect(noGrid({ altKey: false }, on)).toBe(true)
    // Each toggle stands in for its own key only
    expect(noGrid({}, { ...NO_MODIFIERS, freeAngle: true, additive: true })).toBe(false)
    expect(additive({}, { ...NO_MODIFIERS, noGrid: true, freeAngle: true })).toBe(false)
  })

  it('read the toggles from the store as they are now', () => {
    expect(isAdditive({ shiftKey: false })).toBe(false)
    expect(isFreeAngle()).toBe(false)
    expect(isNoGrid()).toBe(false)
    useStore.getState().setModifier('additive', true)
    useStore.getState().setModifier('noGrid', true)
    expect(isAdditive({ shiftKey: false })).toBe(true)
    expect(isFreeAngle()).toBe(false)
    expect(isNoGrid({ altKey: false })).toBe(true)
    expect(isFreeAngle(true)).toBe(true)
  })
})
