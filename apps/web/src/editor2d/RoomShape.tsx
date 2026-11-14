import { useMemo } from 'react'
import { Group, Line, Rect, Text } from 'react-konva'
import { add, areaDeviation, dist, mul, norm, polygonArea, signedArea, sub, type Room } from '@romslig/shared'
import { useStore } from '../store.ts'
import { ROOM_COLORS, fmtM, fmtM2 } from '../theme.ts'
import {
  DIM_FONT_SIZE,
  LINE_HEIGHT,
  PLATE_PAD_Y,
  ROOM_FONT_MAX,
  edgeLabelFits,
  roomLabelLayout,
  type LabelVariant,
} from './labelFit.ts'
import { PLATE_FILL, PlateText } from './planShapes.tsx'

/**
 * Length of each edge of a room, measured along the inside face of the walls, drawn just inside
 * the room and parallel to the wall. Comparable with tape-measured lengths. An edge too short on
 * screen for its label gets none (see edgeLabelFits), so zooming in reveals the short ones.
 */
export function RoomEdgeLengths({ room, scale }: { room: Room; scale: number }) {
  const poly = room.polygon
  if (poly.length < 3) return null
  const ccw = signedArea(poly) > 0
  return (
    <Group listening={false}>
      {poly.map((a, i) => {
        const b = poly[(i + 1) % poly.length]!
        const length = dist(a, b)
        const text = fmtM(length)
        if (!edgeLabelFits(length * scale, text)) return null
        const d = norm(sub(b, a))
        const inward = ccw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x }
        const at = add(add(a, mul(sub(b, a), 0.5)), mul(inward, 10 / scale))
        // Keep text upright: flip edges that point leftwards
        let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI
        if (angle > 90) angle -= 180
        if (angle <= -90) angle += 180
        return (
          <PlateText
            key={`${a.x}:${a.y}`}
            at={at}
            text={text}
            scale={scale}
            fontSize={DIM_FONT_SIZE}
            color="#1e40af"
            rotation={angle}
          />
        )
      })}
    </Group>
  )
}

/** The room's outline and fill; clicking it selects the room. Its text is drawn by RoomLabel. */
export function RoomShape({ room, selected, interactive }: { room: Room; selected: boolean; interactive: boolean }) {
  const select = useStore((s) => s.select)
  if (room.polygon.length < 3) return null
  return (
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
  )
}

/**
 * The room's name, area and (when there is a stated area) the deviation from it, on a plate inside
 * the room. When that does not fit on screen the text shrinks, then drops to fewer lines, and
 * finally disappears (see roomLabelLayout). Drawn above furniture but never catches clicks.
 */
export function RoomLabel({ room, scale }: { room: Room; scale: number }) {
  const dev = areaDeviation(room)
  const sign = dev !== null && dev > 0 ? '+' : ''
  const devText = dev !== null ? `oppgitt ${fmtM2(room.statedArea!)} (${sign}${(dev * 100).toFixed(0)} %)` : null
  const devColor = dev !== null && Math.abs(dev) > 0.05 ? '#dc2626' : '#15803d'
  // Recomputed on zoom and when the room changes, not on every re-render of the plan
  const layout = useMemo(() => {
    if (room.polygon.length < 3) return null
    const area = fmtM2(polygonArea(room.polygon))
    const name = room.name.trim()
    const present = (lines: string[]) => lines.filter((l) => l !== '')
    // The stated-area line is extra: show it only while the label stays near full size
    const variants: LabelVariant[] = [
      ...(devText ? [{ lines: present([name, area, devText]), minFontSize: ROOM_FONT_MAX - 1 }] : []),
      ...[[name, area], [name], [area]].map(present),
    ]
    return roomLabelLayout(room.polygon, variants, scale)
  }, [room.polygon, room.name, devText, scale])
  if (!layout) return null
  const k = 1 / scale
  const { at, fontSize, lines, width, height } = layout
  const x = at.x - (width / 2) * k
  const top = at.y - (height / 2) * k
  const lineH = fontSize * LINE_HEIGHT
  return (
    <Group listening={false}>
      <Rect x={x} y={top} width={width * k} height={height * k} cornerRadius={3 * k} fill={PLATE_FILL} />
      {lines.map((line, i) => {
        const isDev = line === devText
        return (
          <Text
            key={line}
            x={x}
            y={top + (PLATE_PAD_Y + i * lineH) * k}
            width={width * k}
            height={lineH * k}
            align="center"
            verticalAlign="middle"
            wrap="none"
            text={line}
            fontSize={(isDev ? fontSize * 0.85 : fontSize) * k}
            fontStyle={isDev ? 'normal' : 'bold'}
            fill={isDev ? devColor : '#0f172a'}
          />
        )
      })}
    </Group>
  )
}
