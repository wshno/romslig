import type { Room } from '@romslig/shared'

/**
 * The corner of a hand-drawn room that a finger last touched. A mouse removes a corner with Delete
 * while it hovers it; a finger has no hover and no Delete key, so it touches the corner and then
 * «Fjern hjørne» in the DrawBar.
 */
export interface PickedCorner {
  roomId: string
  index: number
}

/**
 * The picked corner's index when it still belongs to `room` (the room whose corners have handles
 * now), or null: the room was deselected or replaced, or undo took the corner away.
 */
export function pickedCornerOf(picked: PickedCorner | null, room: Room | undefined): number | null {
  if (!picked || !room || picked.roomId !== room.id) return null
  return picked.index < room.polygon.length ? picked.index : null
}
