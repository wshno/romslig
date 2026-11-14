import { useRef } from 'react'
import { Circle } from 'react-konva'
import {
  add,
  mul,
  snapPoint,
  sub,
  wallLength,
  wallsMovedWith,
  type Scenario,
  type Wall,
  type WallEnd,
} from '@romslig/shared'
import { beginGesture, endGesture, useStore } from '../store.ts'
import { fmtM } from '../theme.ts'
import { Label } from './planShapes.tsx'
import { SNAP_GRID } from './planStyle.ts'

export function WallHandles({
  wall,
  scenario,
  scale,
  shiftRef,
}: {
  wall: Wall
  scenario: Scenario
  scale: number
  shiftRef: React.RefObject<boolean>
}) {
  // The variant as it was when the drag started, and the walls that stand still during it. Every
  // move is worked out from that start, so connected walls, openings and rooms follow the pointer
  // instead of drifting with each step.
  const dragRef = useRef<{ base: Scenario; still: Wall[] } | null>(null)
  const mid = add(wall.a, mul(sub(wall.b, wall.a), 0.5))
  const handle = (end: WallEnd) => (
    <Circle
      x={wall[end].x}
      y={wall[end].y}
      radius={6 / scale}
      fill="#fff"
      stroke="#2563eb"
      strokeWidth={2}
      strokeScaleEnabled={false}
      draggable
      onDragStart={() => {
        beginGesture()
        const moving = new Set(wallsMovedWith(scenario, wall.id, end))
        dragRef.current = { base: scenario, still: scenario.walls.filter((w) => !moving.has(w.id)) }
      }}
      onDragMove={(e) => {
        const drag = dragRef.current
        if (!drag) return
        const r = snapPoint(
          { x: e.target.x(), y: e.target.y() },
          {
            walls: drag.still,
            anchor: end === 'a' ? wall.b : wall.a,
            tolerance: 12 / scale,
            ortho: !shiftRef.current,
            grid: e.evt.altKey ? undefined : SNAP_GRID,
          },
        )
        e.target.position(r.point)
        useStore.getState().dragWallEndpoint(drag.base, wall.id, end, r.point)
      }}
      onDragEnd={() => {
        dragRef.current = null
        endGesture()
      }}
    />
  )
  return (
    <>
      {handle('a')}
      {handle('b')}
      <Label at={mid} text={fmtM(wallLength(wall))} scale={scale} color="#2563eb" />
    </>
  )
}
