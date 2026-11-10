import { Group, Line, Text } from 'react-konva'
import {
  add,
  areaDeviation,
  dist,
  mul,
  norm,
  polygonArea,
  polygonCentroid,
  signedArea,
  sub,
  type Room,
} from '@romslig/shared'
import { useStore } from '../store.ts'
import { ROOM_COLORS, fmtM, fmtM2 } from '../theme.ts'

/**
 * Length of each edge of a room, measured along the inside face of the walls, drawn just inside
 * the room and parallel to the wall. Comparable with tape-measured lengths.
 */
export function RoomEdgeLengths({ room, scale }: { room: Room; scale: number }) {
  const poly = room.polygon
  if (poly.length < 3) return null
  const ccw = signedArea(poly) > 0
  const width = 120 / scale
  const fontSize = 11 / scale
  return (
    <Group listening={false}>
      {poly.map((a, i) => {
        const b = poly[(i + 1) % poly.length]!
        const length = dist(a, b)
        if (length < 0.3) return null
        const d = norm(sub(b, a))
        const inward = ccw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x }
        const at = add(add(a, mul(sub(b, a), 0.5)), mul(inward, 10 / scale))
        // Keep text upright: flip edges that point leftwards
        let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI
        if (angle > 90) angle -= 180
        if (angle <= -90) angle += 180
        return (
          <Text
            key={`${a.x}:${a.y}`}
            x={at.x}
            y={at.y}
            width={width}
            offsetX={width / 2}
            offsetY={fontSize / 2}
            rotation={angle}
            align="center"
            text={fmtM(length)}
            fontSize={fontSize}
            fill="#1e40af"
            shadowColor="#fff"
            shadowBlur={3 / scale}
            shadowOpacity={1}
          />
        )
      })}
    </Group>
  )
}

export function RoomShape({
  room,
  scale,
  selected,
  interactive,
}: {
  room: Room
  scale: number
  selected: boolean
  interactive: boolean
}) {
  const select = useStore((s) => s.select)
  if (room.polygon.length < 3) return null
  const c = polygonCentroid(room.polygon)
  const area = polygonArea(room.polygon)
  const dev = areaDeviation(room)
  const width = 200 / scale
  return (
    <Group>
      <Line
        points={room.polygon.flatMap((p) => [p.x, p.y])}
        closed
        fill={ROOM_COLORS[room.type]}
        opacity={selected ? 0.6 : 0.35}
        stroke={selected ? '#2563eb' : undefined}
        strokeWidth={2}
        strokeScaleEnabled={false}
        onClick={(e) => {
          if (!interactive) return
          e.cancelBubble = true
          select({ kind: 'room', id: room.id })
        }}
      />
      <Text
        x={c.x - width / 2}
        y={c.y - 18 / scale}
        width={width}
        align="center"
        text={`${room.name}\n${fmtM2(area)}`}
        fontSize={13 / scale}
        lineHeight={1.2}
        fontStyle="bold"
        fill="#0f172a"
        listening={false}
      />
      {dev !== null && (
        <Text
          x={c.x - width / 2}
          y={c.y + 15 / scale}
          width={width}
          align="center"
          text={`oppgitt ${fmtM2(room.statedArea!)} (${dev > 0 ? '+' : ''}${(dev * 100).toFixed(0)} %)`}
          fontSize={11 / scale}
          fill={Math.abs(dev) > 0.05 ? '#dc2626' : '#15803d'}
          listening={false}
        />
      )}
    </Group>
  )
}
