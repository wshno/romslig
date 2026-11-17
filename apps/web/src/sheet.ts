import type { PhotoFlowEvent } from './photoFlow.ts'
import type { SelectedItem, Tool } from './store.ts'

/**
 * Where the inspector's bottom sheet on a phone rests: only its handle and the tabs showing, half
 * the view, or all of it.
 */
export type SheetSnap = 'closed' | 'half' | 'full'

/** What the sheet reacts to in the store. */
export interface SheetWatch {
  tool: Tool
  selection: readonly SelectedItem[]
  /** The active variant's furniture ids, to tell a piece just added from one picked. */
  furnitureIds: readonly string[]
}

/**
 * Where the sheet goes when the tool or the selection changes. `prev` is what the sheet last
 * reacted to, not the store's previous state: adding a piece puts it in the variant and selects it
 * in two steps, so only the state from before both still lacks the new piece.
 *
 * - a drawing tool is picked: down, so the plan is free to draw on;
 * - a piece is added from the catalog (nothing was selected, and now only a piece that did not exist
 *   is): down, so it can be seen in the plan. Duplicating also makes a new piece, but from a
 *   selection, so the sheet stays where it is;
 * - something else gets selected: up to half if it was down, so its settings show.
 */
export function snapAfter(current: SheetSnap, prev: SheetWatch, next: SheetWatch): SheetSnap {
  if (next.tool !== prev.tool && next.tool !== 'select') return 'closed'
  if (next.selection === prev.selection || next.selection.length === 0) return current
  const [only] = next.selection
  const added =
    prev.selection.length === 0 &&
    next.selection.length === 1 &&
    only!.kind === 'furniture' &&
    !prev.furnitureIds.includes(only!.id) &&
    next.furnitureIds.includes(only!.id)
  if (added) return 'closed'
  return current === 'closed' ? 'half' : current
}

/**
 * Where the sheet goes for the photo flow (photoFlow.ts). `before` is where it was when the flow
 * opened.
 *
 * - it opens: full height, so the photos, the direction pickers and the buttons get the screen;
 * - the user closes it (Lukk, Avbryt): back to where it was before, as if it had not been opened;
 * - the furniture is added: down, so the plan shows the new pieces, selected and ready to move;
 * - it leaves the screen some other way (a tab or a selection replaced it): it stays.
 */
export function snapForPhotoFlow(event: PhotoFlowEvent, current: SheetSnap, before: SheetSnap): SheetSnap {
  if (event === 'open') return 'full'
  if (event === 'cancel') return before
  if (event === 'placed') return 'closed'
  return current
}

/** A tap on the handle: up a step, and from the top back down. */
export function snapOnTap(current: SheetSnap): SheetSnap {
  if (current === 'closed') return 'half'
  if (current === 'half') return 'full'
  return 'closed'
}

/** Where a drag that let go at `height` (px) comes to rest: the nearest of the three heights. */
export function nearestSnap(height: number, heights: Record<SheetSnap, number>): SheetSnap {
  const order: SheetSnap[] = ['half', 'full']
  return order.reduce<SheetSnap>(
    (best, s) => (Math.abs(heights[s] - height) < Math.abs(heights[best] - height) ? s : best),
    'closed',
  )
}
