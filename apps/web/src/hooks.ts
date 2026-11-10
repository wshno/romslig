import { useMemo, useRef, useSyncExternalStore, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react'
import { describeFurnitureIssue, furnitureIssues, type FurnitureIssue } from '@romslig/shared'
import { mergeSteps, useScenario, useStore } from './store.ts'

const EMPTY = new Map<string, FurnitureIssue[]>()

/** Furniture problems for the active scenario, recomputed when it changes. */
export function useFurnitureIssues(): Map<string, FurnitureIssue[]> {
  const scenario = useScenario()
  return useMemo(() => (scenario ? furnitureIssues(scenario) : EMPTY), [scenario])
}

/** Human-readable (Norwegian) description of an issue. */
export const describeIssue = describeFurnitureIssue

/** Whether there is anything to undo and to redo. */
export function useHistory(): { canUndo: boolean; canRedo: boolean } {
  const { subscribe, getState } = useStore.temporal
  return {
    canUndo: useSyncExternalStore(subscribe, () => getState().pastStates.length > 0),
    canRedo: useSyncExternalStore(subscribe, () => getState().futureStates.length > 0),
  }
}

const NOT_TYPED = new Set(['checkbox', 'radio', 'range', 'file', 'button', 'submit', 'reset', 'color'])
const isTextField = (el: EventTarget): boolean =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NOT_TYPED.has(el.type))

/**
 * Makes what is typed into one field a single undo step instead of one per keystroke. The step
 * ends when focus leaves the field or Enter is pressed, so going back to the field makes a new one.
 * Spread the result on an element that contains the fields.
 */
export function useTypingAsOneUndoStep() {
  const typing = useRef<{ field: EventTarget; steps: ReturnType<typeof mergeSteps> } | null>(null)
  const stop = (field: EventTarget) => {
    if (typing.current?.field === field) typing.current = null
  }
  return {
    // The field's own onChange runs between these two
    onChangeCapture: (e: FormEvent) => {
      if (!isTextField(e.target)) return
      if (typing.current?.field !== e.target) typing.current = { field: e.target, steps: mergeSteps() }
      typing.current.steps.before()
    },
    onChange: (e: FormEvent) => {
      if (typing.current?.field === e.target) typing.current.steps.after()
    },
    onBlur: (e: FocusEvent) => stop(e.target),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') stop(e.target)
    },
  }
}
