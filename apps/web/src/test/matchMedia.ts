import { act } from '@testing-library/react'
import { vi } from 'vitest'

/**
 * jsdom has no matchMedia. This stands in for it: each query matches when `matches(query)` says so,
 * and `set` changes the answers and tells the listeners, like a window being resized. Undo with
 * `vi.unstubAllGlobals()`.
 */
export function stubMatchMedia(initial: Record<string, boolean> = {}) {
  const answers = new Map(Object.entries(initial))
  const listeners = new Map<string, Set<() => void>>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return answers.get(query) ?? false
    },
    addEventListener: (_type: 'change', fn: () => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query)!.add(fn)
    },
    removeEventListener: (_type: 'change', fn: () => void) => listeners.get(query)?.delete(fn),
  }))
  return {
    set(query: string, matches: boolean) {
      answers.set(query, matches)
      act(() => {
        for (const fn of listeners.get(query) ?? []) fn()
      })
    },
    /** How many listeners a query has now, to check that unmounting removes them. */
    listening: (query: string) => listeners.get(query)?.size ?? 0,
  }
}
