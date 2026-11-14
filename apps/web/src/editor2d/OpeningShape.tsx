import { useRef } from 'react'
import { Arc, Group, Line, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  add,
  clampOpening,
  moveOpening,
  mul,
  openingCentre,
  sub,
  wallDir,
  type Opening,
  type Scenario,
  type Vec2,
  type Wall,
} from '@romslig/shared'
import { activeScenario, beginGesture, endGesture, useStore } from '../store.ts'
import { fmtM } from '../theme.ts'
import { OPENING_COLORS, SNAP_GRID } from './planStyle.ts'

/** How close (screen px) the dragged opening's centre has to come to another wall to go over to it. */
const SWITCH_WALL_PX = 20

export function OpeningShape(props: {
  o: Opening
  wall: Wall
  scale: number
  selected: boolean
  interactive: boolean
  onSelect(): void
  /** Called with true when a drag starts and false when it ends. */
  onDragging(dragging: boolean): void
}) {
  const { o, wall, scale, selected } = props
  // The variant as it was when the drag started, and where on the opening it was grabbed
  const dragRef = useRef<{ base: Scenario; grab: Vec2 } | null>(null)
  const pointer = (n: Konva.Node) => n.getLayer()?.getRelativePointerPosition() ?? null

  // Every move is applied to the variant from drag start, so the result does not depend on the path
  const onDragMove = (e: KonvaEventObject<DragEvent>) => {
    const n = e.target
    const p = pointer(n)
    if (!dragRef.current || !p) return
    const { base, grab } = dragRef.current
    const next = moveOpening(base, o.id, sub(p, grab), {
      snapStep: e.evt.altKey ? undefined : SNAP_GRID,
      switchDist: SWITCH_WALL_PX / scale,
    })
    const m = next.openings.find((x) => x.id === o.id)!
    const w = next.walls.find((x) => x.id === m.wallId)!
    // Konva moved the node with the pointer; put it where the opening lands instead
    const d = wallDir(w)
    n.position(add(w.a, mul(d, clampOpening(m, w).start)))
    n.rotation((Math.atan2(d.y, d.x) * 180) / Math.PI)
    useStore.getState().updateOpening(o.id, { wallId: m.wallId, offset: m.offset, flip: m.flip })
  }
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
      onDragStart={(e) => {
        const project = useStore.getState().project
        const p = pointer(e.target)
        if (!project || !p) return
        beginGesture()
        dragRef.current = { base: activeScenario(project), grab: sub(p, openingCentre(o, wall)) }
        props.onDragging(true)
      }}
      onDragMove={onDragMove}
      onDragEnd={() => {
        dragRef.current = null
        endGesture()
        props.onDragging(false)
      }}
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
