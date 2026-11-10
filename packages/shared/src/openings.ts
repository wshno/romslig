import { doorSwingNormal } from './furniture.ts'
import { add, clampOpening, mul, wallDir } from './geometry.ts'
import type { Opening, Vec2, Wall } from './model.ts'

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
