/**
 * The photo flow (PhotoEntry's room picker and the recognise panel) tells the phone's bottom sheet
 * when it is on screen and how it ended, so the sheet can give it the whole height and get out of
 * the way after. A module-level signal rather than store state: it is about the screen, not the
 * project, and nothing else needs it. On a desktop nothing listens.
 *
 * - `open`: the flow came on screen (the entry button was tapped, or a panel was restored);
 * - `cancel`: the user closed it with Lukk or Avbryt;
 * - `placed`: the recognised furniture was added to the plan and selected;
 * - `gone`: the last flow left the screen, however (also after the two above, and when a tab or a
 *   selection replaced it).
 */
export type PhotoFlowEvent = 'open' | 'cancel' | 'placed' | 'gone'

let holders = 0
const listeners = new Set<(event: PhotoFlowEvent) => void>()

const emit = (event: PhotoFlowEvent) => listeners.forEach((l) => l(event))

/** Whether a photo flow is on screen now. */
export function photoFlowOpen(): boolean {
  return holders > 0
}

/** The flow came on screen. Returns the release for when it leaves it (an effect's cleanup). */
export function holdPhotoFlow(): () => void {
  holders++
  emit('open')
  let released = false
  return () => {
    if (released) return
    released = true
    holders--
    if (holders === 0) emit('gone')
  }
}

/** The user ended the flow: closed it, or added what was recognised. */
export function endPhotoFlow(how: 'cancel' | 'placed'): void {
  emit(how)
}

export function onPhotoFlow(listener: (event: PhotoFlowEvent) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
