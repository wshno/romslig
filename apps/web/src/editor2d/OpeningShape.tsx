import { Arc, Group, Line, Rect, Text } from 'react-konva'
import { add, clampOpening, mul, wallDir, wallLength, type Opening, type Wall } from '@romslig/shared'
import { beginGesture, endGesture } from '../store.ts'
import { fmtM } from '../theme.ts'
import { OPENING_COLORS } from './planStyle.ts'

export function OpeningShape(props: {
  o: Opening
  wall: Wall
  scale: number
  selected: boolean
  interactive: boolean
  onSelect(): void
  onMove(offset: number): void
}) {
  const { o, wall, scale, selected } = props
  const { start, end } = clampOpening(o, wall)
  const d = wallDir(wall)
  const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI
  const p0 = add(wall.a, mul(d, start))
  const w = end - start
  const t = wall.thickness
  const color = selected ? '#2563eb' : OPENING_COLORS[o.kind]
  const sw = 1.5
  return (
    <Group
      x={p0.x}
      y={p0.y}
      rotation={angle}
      draggable={props.interactive && selected}
      onClick={(e) => {
        if (!props.interactive) return
        e.cancelBubble = true
        props.onSelect()
      }}
      onDragStart={beginGesture}
      onDragMove={(e) => {
        const n = e.target
        const pos = { x: n.x(), y: n.y() }
        // pos is the start corner; project centre onto the wall
        const centre = add(pos, mul(d, w / 2))
        const off = Math.max(
          w / 2,
          Math.min(wallLength(wall) - w / 2, (centre.x - wall.a.x) * d.x + (centre.y - wall.a.y) * d.y),
        )
        const snapped = add(wall.a, mul(d, off - w / 2))
        n.position(snapped)
        props.onMove(off)
      }}
      onDragEnd={endGesture}
    >
      <Rect
        x={0}
        y={-t / 2 - 0.005}
        width={w}
        height={t + 0.01}
        fill="#ffffff"
        stroke={color}
        strokeWidth={sw}
        strokeScaleEnabled={false}
      />
      {o.kind === 'door' && (
        <Group scaleY={o.flip ? -1 : 1}>
          <Line points={[0, -t / 2, 0, -t / 2 - w]} stroke={color} strokeWidth={sw} strokeScaleEnabled={false} />
          <Arc
            x={0}
            y={-t / 2}
            innerRadius={w}
            outerRadius={w}
            angle={90}
            rotation={-90}
            stroke={color}
            strokeWidth={sw}
            strokeScaleEnabled={false}
            dash={[4, 3]}
          />
        </Group>
      )}
      {o.kind === 'window' && <Line points={[0, 0, w, 0]} stroke={color} strokeWidth={sw} strokeScaleEnabled={false} />}
      {o.kind === 'opening' && (
        <Line points={[0, 0, w, 0]} stroke={color} strokeWidth={sw} dash={[4, 4]} strokeScaleEnabled={false} />
      )}
      {selected && (
        <Text x={0} y={t / 2 + 4 / scale} width={w} align="center" text={fmtM(w)} fontSize={11 / scale} fill={color} />
      )}
    </Group>
  )
}
