import { detectRoomPolygons, pointInPolygon, polygonCentroid } from './geometry.ts'
import { roomAt } from './furniture.ts'
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
