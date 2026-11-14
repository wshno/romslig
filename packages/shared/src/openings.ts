import { doorSwingNormal } from './furniture.ts'
import {
  add,
  clampOpening,
  dot,
  fitOpening,
  mul,
  nearestWall,
  projectOntoWall,
  snapToStep,
  sub,
  wallDir,
  wallLength,
} from './geometry.ts'
import type { Opening, Scenario, Vec2, Wall } from './model.ts'

/**
 * Where a door's leaf stands when it is wide open, as the plan draws it: hinged at the start of
 * the opening, on the face of the wall it swings out from, at a right angle to the wall. The 3D
 * view puts the leaf here, so it stands along the edge of the square `doorSwingPolygon` keeps
 * free.
 */
export function doorLeaf(o: Opening, wall: Wall): { hinge: Vec2; tip: Vec2 } | null {
  if (o.kind !== 'door') return null
  const { start, end } = clampOpening(o, wall)
  const n = doorSwingNormal(o, wall)
  const hinge = add(add(wall.a, mul(wallDir(wall), start)), mul(n, wall.thickness / 2))
  return { hinge, tip: add(hinge, mul(n, end - start)) }
}

/** The point on the wall's centre line in the middle of the opening (as it fits in the wall). */
export function openingCentre(o: Opening, wall: Wall): Vec2 {
  const { start, end } = clampOpening(o, wall)
  return add(wall.a, mul(wallDir(wall), (start + end) / 2))
}

/**
 * The gap along the wall between the opening and the nearer end of its wall, which end that is,
 * and the point on the centre line where the opening's edge on that side is.
 */
export function openingEndGap(o: Opening, wall: Wall): { gap: number; end: 'a' | 'b'; edge: Vec2 } {
  const { start, end } = clampOpening(o, wall)
  const L = wallLength(wall)
  const d = wallDir(wall)
  return start <= L - end
    ? { gap: start, end: 'a', edge: add(wall.a, mul(d, start)) }
    : { gap: L - end, end: 'b', edge: add(wall.a, mul(d, end)) }
}

export interface MoveOpeningOptions {
  /**
   * Round the gap between the nearer wall end and the opening's edge to this step (m), like the
   * grid snap elsewhere. Omit (or 0) for no rounding.
   */
  snapStep?: number
  /**
   * How close (m) the pointer has to come to another wall for the opening to go over to it. Omit
   * (or 0) to keep the opening on its own wall.
   */
  switchDist?: number
  /**
   * Where on the opening it was grabbed: the pointer minus the opening's centre at drag start.
   * Kept while the opening slides along its own wall, so it does not jump to centre itself under
   * the pointer. Defaults to no offset.
   */
  grab?: Vec2
}

/**
 * The opening moved by a drag with the pointer at `pointer`.
 *
 * - On its own wall its centre goes as close to `pointer - grab` as it can: slid along the wall
 *   and kept inside it.
 * - When the pointer itself (not the grabbed centre, which can lag behind it by up to half the
 *   opening) is within `switchDist` of another wall and closer to that wall than to the opening's
 *   own, the opening goes over to that wall, centred on the pointer's projection on it.
 * - A wall shorter than the opening is never a target: the opening keeps its width rather than
 *   being made narrower without the user asking.
 * - Width, height and sill are kept. A door keeps its swing relative to where it came from: if it
 *   swung towards the new wall (into the room the two walls share), it swings back towards the old
 *   place from the new wall, and the other way round. When that says nothing (the walls lie on one
 *   line) it keeps facing the same way in the plan.
 *
 * Pure, and it depends only on the scenario and the pointer: applied to the scenario from the start
 * of a drag, the result does not depend on the path the pointer took.
 */
export function moveOpening(s: Scenario, openingId: string, pointer: Vec2, opts: MoveOpeningOptions = {}): Scenario {
  const o = s.openings.find((x) => x.id === openingId)
  const own = o && s.walls.find((w) => w.id === o.wallId)
  if (!o || !own) return s

  let wall = own
  if (opts.switchDist) {
    const candidates = s.walls.filter((w) => w.id === own.id || wallLength(w) >= o.width - 1e-9)
    const near = nearestWall(pointer, candidates, opts.switchDist)
    if (near) wall = near.wall
  }

  const L = wallLength(wall)
  const width = Math.min(o.width, L)
  const centre = wall.id === own.id && opts.grab ? sub(pointer, opts.grab) : pointer
  let offset = projectOntoWall(centre, wall).offset
  if (opts.snapStep) {
    // Round the gap to the nearer wall end, so the distance shown while dragging is a round number
    const fromA = offset - width / 2
    const fromB = L - (offset + width / 2)
    offset =
      fromA <= fromB ? snapToStep(fromA, opts.snapStep) + width / 2 : L - snapToStep(fromB, opts.snapStep) - width / 2
  }
  let moved: Opening = fitOpening({ ...o, wallId: wall.id, offset }, wall)
  if (wall.id !== own.id) moved = { ...moved, flip: flipOnNewWall(o, own, moved, wall) }

  const same = moved.wallId === o.wallId && moved.offset === o.offset && moved.flip === o.flip
  return same ? s : { ...s, openings: s.openings.map((x) => (x.id === o.id ? moved : x)) }
}

/** The `flip` on the new wall that keeps the swing relative to where the opening came from. */
function flipOnNewWall(o: Opening, from: Wall, moved: Opening, to: Wall): boolean {
  const eps = 1e-6
  const oldN = doorSwingNormal(o, from)
  const oldPos = openingCentre(o, from)
  const newPos = openingCentre(moved, to)
  const unflipped = doorSwingNormal({ flip: false }, to)
  const towardsNew = dot(sub(newPos, oldPos), oldN)
  const back = dot(unflipped, sub(oldPos, newPos))
  if (Math.abs(towardsNew) > eps && Math.abs(back) > eps) {
    // Swung towards the new wall → swing towards the old place from it; swung away → away
    const wantBack = towardsNew > 0
    return wantBack !== back > 0
  }
  return dot(unflipped, oldN) < 0
}
