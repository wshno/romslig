import {
  add,
  clampOpening,
  closestPointOnSegment,
  detectRoomPolygons,
  interiorPoint,
  mul,
  pointInPolygon,
  wallDir,
} from './geometry.ts'
import { roomAt, roomEdges, type PlanSide } from './furniture.ts'
import { newId, type Room, type Scenario } from './model.ts'

/**
 * Re-detects rooms from the walls. Rooms that still exist (a point inside the old room lies in a
 * new room) keep id, name, type and stated area. Rooms that lie outside everything the walls
 * enclose are kept as they are: they were drawn by hand across an open area. Furniture is
 * re-assigned to the room it now stands in.
 */
export function redetectRooms(s: Scenario): Scenario {
  const used = new Set<string>()
  const polygons = detectRoomPolygons(s.walls)
  const inside = new Map(s.rooms.filter((r) => r.polygon.length >= 3).map((r) => [r.id, interiorPoint(r.polygon)]))
  const detected: Room[] = polygons.map((poly, i) => {
    const prev = s.rooms.find((r) => !used.has(r.id) && inside.has(r.id) && pointInPolygon(inside.get(r.id)!, poly))
    if (prev) {
      used.add(prev.id)
      return { ...prev, polygon: poly }
    }
    return { id: newId('r_'), name: `Rom ${i + 1}`, type: 'annet', polygon: poly, statedArea: null }
  })
  const drawn = s.rooms.filter((r) => {
    const p = inside.get(r.id)
    if (!p || used.has(r.id)) return false
    return !polygons.some((poly) => pointInPolygon(p, poly) || pointInPolygon(interiorPoint(poly), r.polygon))
  })
  const rooms = [...detected, ...drawn]
  const furniture = s.furniture.map((f) => ({ ...f, roomId: roomAt(f, rooms)?.id ?? null }))
  return { ...s, rooms, furniture }
}

/** Norwegian names of the plan sides, as in "veggen øverst i plantegningen". */
export const SIDE_NAMES = { top: 'øverst', right: 'til høyre', bottom: 'nederst', left: 'til venstre' } as const

/**
 * Which plan wall appears where in a photo taken facing `facing`: straight ahead, at the left and
 * right edges of the photo, and behind the photographer.
 */
export function viewSides(facing: PlanSide): { ahead: PlanSide; left: PlanSide; right: PlanSide; behind: PlanSide } {
  const order: PlanSide[] = ['top', 'right', 'bottom', 'left'] // clockwise in the plan
  const i = order.indexOf(facing)
  return { ahead: facing, right: order[(i + 1) % 4]!, behind: order[(i + 2) % 4]!, left: order[(i + 3) % 4]! }
}

/**
 * Describes a room's walls for someone looking at photos of it: for each side of the plan, the
 * wall length and the doors and windows in it (and which room a door leads to).
 */
export function describeRoomSides(s: Scenario, roomId: string): string {
  const room = s.rooms.find((r) => r.id === roomId)
  if (!room) return ''
  const lines: string[] = []
  for (const e of roomEdges(room.polygon)) {
    if (!e.side || e.length < 0.3) continue
    const features = s.openings.flatMap((o) => {
      const w = s.walls.find((x) => x.id === o.wallId)
      if (!w) return []
      const { start, end } = clampOpening(o, w)
      const c = add(w.a, mul(wallDir(w), (start + end) / 2))
      // An opening belongs to this edge if its centre is close to the edge line
      const near = closestPointOnSegment(c, e.a, e.b)
      if (near.dist > w.thickness / 2 + 0.1) return []
      const beyond = roomAt(add(c, mul(e.inward, -(w.thickness + 0.3))), s.rooms)
      const kind = { door: 'dør', window: 'vindu', opening: 'åpning' }[o.kind]
      const to = o.kind !== 'window' && beyond ? ` til «${beyond.name}»` : ''
      return [`${kind} ${Math.round(o.width * 100)} cm${to}`]
    })
    lines.push(
      `- Veggen ${SIDE_NAMES[e.side]} i plantegningen (${e.side}), ${e.length.toFixed(2)} m: ${features.length ? features.join(', ') : 'ingen dører eller vinduer'}`,
    )
  }
  return lines.join('\n')
}
