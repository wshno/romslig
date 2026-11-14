import { useRef } from 'react'
import { Circle, Line } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  add,
  dot,
  mul,
  snapPoint,
  sub,
  wallDir,
  wallLength,
  wallsMovedWith,
  type Scenario,
  type Vec2,
  type Wall,
  type WallEnd,
} from '@romslig/shared'
import { beginGesture, endGesture, useStore } from '../store.ts'
import { fmtM } from '../theme.ts'
import { Label } from './planShapes.tsx'
import { SNAP_GRID, wallQuad } from './planStyle.ts'

export function WallHandles({
  wall,
  scenario,
  scale,
  shiftRef,
  moved = null,
}: {
  wall: Wall
  scenario: Scenario
  scale: number
  shiftRef: React.RefObject<boolean>
  /** How far the wall has been moved while its body is dragged (see WallBody), else null. */
  moved?: number | null
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
      <Label
        at={mid}
        text={moved === null ? fmtM(wallLength(wall)) : `Flyttet ${fmtM(Math.abs(moved))}`}
        scale={scale}
        color="#2563eb"
      />
    </>
  )
}

/** The pointer in plan coordinates (metres). */
const pointerOf = (e: KonvaEventObject<MouseEvent | DragEvent>): Vec2 | null =>
  e.target.getStage()?.getRelativePointerPosition() ?? null

const setCursor = (e: KonvaEventObject<MouseEvent>, cursor: string) => {
  const c = e.target.getStage()?.container()
  if (c) c.style.cursor = cursor
}

/**
 * An invisible copy of the selected wall's outline that can be dragged: it moves the whole wall at
 * a right angle to itself (moveWall), in 10 cm steps unless Alt is held, as one undo step. Drawn
 * right above the walls, so openings, furniture and the end handles on top of it keep their own
 * clicks and drags. The shape itself stays put: it is drawn from the wall in the store, which
 * follows the pointer.
 */
export function WallBody({
  wall,
  scenario,
  onMove,
}: {
  wall: Wall
  scenario: Scenario
  /** Called with the current offset while dragging, and with null when the drag ends. */
  onMove(offset: number | null): void
}) {
  // The variant as it was when the drag started, where the pointer grabbed the wall, and the
  // wall's left normal (moveWall's positive direction)
  const dragRef = useRef<{ base: Scenario; from: Vec2; normal: Vec2 } | null>(null)
  return (
    <Line
      name="wall-body"
      points={wallQuad(wall, scenario.walls)}
      closed
      fill="transparent"
      hitStrokeWidth={8}
      strokeScaleEnabled={false}
      draggable
      onMouseEnter={(e) => setCursor(e, 'move')}
      onMouseLeave={(e) => setCursor(e, '')}
      onClick={(e) => {
        e.cancelBubble = true
        // It lies over the selected wall, so it takes the Shift+click that toggles the wall out
        if (e.evt.shiftKey) useStore.getState().pick({ kind: 'wall', id: wall.id }, true)
      }}
      onDragStart={(e) => {
        const from = pointerOf(e)
        if (!from) return
        beginGesture()
        const d = wallDir(wall)
        dragRef.current = { base: scenario, from, normal: { x: -d.y, y: d.x } }
        onMove(0)
      }}
      onDragMove={(e) => {
        e.target.position({ x: 0, y: 0 })
        const drag = dragRef.current
        const p = pointerOf(e)
        if (!drag || !p) return
        const raw = dot(sub(p, drag.from), drag.normal)
        const offset = e.evt.altKey ? raw : Math.round(raw / SNAP_GRID) * SNAP_GRID
        onMove(offset)
        useStore.getState().dragWall(drag.base, wall.id, offset)
      }}
      onDragEnd={(e) => {
        e.target.position({ x: 0, y: 0 })
        if (!dragRef.current) return
        dragRef.current = null
        onMove(null)
        endGesture()
      }}
    />
  )
}
