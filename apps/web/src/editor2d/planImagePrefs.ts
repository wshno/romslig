import { useCallback, useSyncExternalStore } from 'react'

/** How the floor plan image is drawn under the 2D plan, remembered per project in this browser. */
export interface PlanImagePrefs {
  visible: boolean
  opacity: number
}

export const DEFAULT_PLAN_IMAGE_PREFS: PlanImagePrefs = { visible: true, opacity: 0.6 }

/** The subset of Storage used here, so tests can pass a fake. */
export type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>

export const planImageKey = (projectId: string) => `romslig:plan-image:${projectId}`

/** localStorage, or null where the browser blocks it (reading the property itself can throw). */
function browserStorage(): PrefsStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The stored prefs for a project, or the defaults when there are none, they are malformed, or storage fails. */
export function loadPlanImagePrefs(projectId: string, storage: PrefsStorage | null = browserStorage()): PlanImagePrefs {
  try {
    const raw = storage?.getItem(planImageKey(projectId))
    if (!raw) return DEFAULT_PLAN_IMAGE_PREFS
    const parsed = JSON.parse(raw) as Partial<Record<keyof PlanImagePrefs, unknown>> | null
    const visible = typeof parsed?.visible === 'boolean' ? parsed.visible : DEFAULT_PLAN_IMAGE_PREFS.visible
    const opacity =
      typeof parsed?.opacity === 'number' && Number.isFinite(parsed.opacity)
        ? Math.min(1, Math.max(0, parsed.opacity))
        : DEFAULT_PLAN_IMAGE_PREFS.opacity
    return { visible, opacity }
  } catch {
    return DEFAULT_PLAN_IMAGE_PREFS
  }
}

/** Stores the prefs for a project; a full or blocked storage is ignored (the setting just isn't remembered). */
export function savePlanImagePrefs(
  projectId: string,
  prefs: PlanImagePrefs,
  storage: PrefsStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(planImageKey(projectId), JSON.stringify(prefs))
  } catch {
    // Ignored on purpose: see above
  }
}

// One in-memory copy per project shared by every Plan2D on the page, so the two panes of the compare
// view always show the plan the same way, and a change in one pane shows in the other at once.
const cache = new Map<string, PlanImagePrefs>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function current(projectId: string): PlanImagePrefs {
  let prefs = cache.get(projectId)
  if (!prefs) {
    prefs = loadPlanImagePrefs(projectId)
    cache.set(projectId, prefs)
  }
  return prefs
}

/** The plan image prefs for a project, and a setter that remembers a change in localStorage. */
export function usePlanImagePrefs(projectId: string): [PlanImagePrefs, (change: Partial<PlanImagePrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, () => current(projectId))
  const update = useCallback(
    (change: Partial<PlanImagePrefs>) => {
      const next = { ...current(projectId), ...change }
      cache.set(projectId, next)
      savePlanImagePrefs(projectId, next)
      for (const l of listeners) l()
    },
    [projectId],
  )
  return [prefs, update]
}
