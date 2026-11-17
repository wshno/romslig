import { useStore, type Modifiers } from '../store.ts'

/** The keys a pointer event or keyboard event carries. */
interface KeyState {
  shiftKey?: boolean
  altKey?: boolean
}

// Every reader of Shift or Alt on the plan goes through these, so a finger gets the same with the
// DrawBar's toggles: the key OR the toggle. A mouse user who never touches the toggles sees no
// difference (they are off, and switched off again whenever the tool changes).

/** Adds to the selection instead of replacing it: Shift on the click, or «Velg flere». */
export const additive = (evt: KeyState | undefined, m: Modifiers): boolean => Boolean(evt?.shiftKey) || m.additive
/** Draws at any angle instead of 45° steps: Shift held, or «Fri vinkel». */
export const freeAngle = (shiftHeld: boolean, m: Modifiers): boolean => shiftHeld || m.freeAngle
/** Leaves the 10 cm grid alone: Alt held, or «Uten rutenett». */
export const noGrid = (evt: KeyState | undefined, m: Modifiers): boolean => Boolean(evt?.altKey) || m.noGrid

const current = () => useStore.getState().modifiers

/** {@link additive} with the toggles as they are now. For event handlers. */
export const isAdditive = (evt?: KeyState): boolean => additive(evt, current())
/** {@link freeAngle} with the toggles as they are now; `shiftHeld` is the keyboard's Shift. */
export const isFreeAngle = (shiftHeld = false): boolean => freeAngle(shiftHeld, current())
/** {@link noGrid} with the toggles as they are now. */
export const isNoGrid = (evt?: KeyState): boolean => noGrid(evt, current())
