import { useSyncExternalStore } from 'react'

/**
 * Phone layout: the editor stacks top bar, view and toolbar, and the inspector becomes a bottom
 * sheet. Must match the `max-width: 720px` media rules in styles.css.
 */
export const NARROW_QUERY = '(max-width: 720px)'
/** A finger rather than a mouse: bigger targets and on-screen stand-ins for keys, whatever the width. */
export const COARSE_QUERY = '(pointer: coarse)'

/**
 * A media query as an external store. matchMedia is looked up on every call, not once at import, so
 * a test can install its stub after this module is loaded; without matchMedia (jsdom) the query
 * never matches, which is the desktop layout.
 */
function mediaStore(query: string) {
  const list = () => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null)
  return {
    subscribe(onChange: () => void) {
      const m = list()
      m?.addEventListener('change', onChange)
      return () => m?.removeEventListener('change', onChange)
    },
    matches: () => list()?.matches ?? false,
  }
}

const narrow = mediaStore(NARROW_QUERY)
const coarse = mediaStore(COARSE_QUERY)

/** True in a phone-wide window (also a narrow desktop window: layout follows the width). */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(narrow.subscribe, narrow.matches, () => false)
}

/** True when the main pointer is a finger (also on a wide tablet: touch behaviour follows the pointer). */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(coarse.subscribe, coarse.matches, () => false)
}
