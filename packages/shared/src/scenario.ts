import {
  add,
  clampOpening,
  closestPointOnSegment,
  detectRoomPolygons,
  mul,
  pointInPolygon,
  polygonCentroid,
  wallDir,
} from './geometry.ts'
import { roomAt, roomEdges } from './furniture.ts'
import { newId, type Room, type Scenario } from './model.ts'

/**
 * Re-detects rooms from the walls. Rooms that still exist (their old centre lies in a new room)
 * keep id, name, type and stated area; furniture is re-assigned to the room it now stands in.
 */
export function redetectRooms(s: Scenario): Scenario {
  const used = new Set<string>()
  const rooms: Room[] = detectRoomPolygons(s.walls).map((poly, i) => {
    const prev = s.rooms.find(
      (r) => !used.has(r.id) && r.polygon.length >= 3 && pointInPolygon(polygonCentroid(r.polygon), poly),
    )
    if (prev) {
      used.add(prev.id)
      return { ...prev, polygon: poly }
    }
    return { id: newId('r_'), name: `Rom ${i + 1}`, type: 'annet', polygon: poly, statedArea: null }
  })
  const furniture = s.furniture.map((f) => ({ ...f, roomId: roomAt(f, rooms)?.id ?? null }))
  return { ...s, rooms, furniture }
}

const SIDE_NAMES = { top: 'øverst', right: 'til høyre', bottom: 'nederst', left: 'til venstre' } as const

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
