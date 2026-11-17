import { useEffect, useRef, useState } from 'react'
import { Circle, Line } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  closestPointOnSegment,
  insertVertex,
  moveVertex,
  polygonArea,
  removeVertex,
  snapCorner,
  type Room,
  type Vec2,
  type Wall,
} from '@romslig/shared'
import { beginGesture, endGesture, useStore } from '../store.ts'
import { fmtM2 } from '../theme.ts'
import { handleHitStroke, useHitSizes } from './hit.ts'
import { isAdditive, isFreeAngle, isNoGrid } from './modifiers.ts'
import { Label } from './planShapes.tsx'
import { SNAP_GRID } from './planStyle.ts'

const setCursor = (e: KonvaEventObject<MouseEvent>, cursor: string) => {
  const c = e.target.getStage()?.container()
  if (c) c.style.cursor = cursor
}

/**
 * Handles on the corners of the selected room, for rooms drawn across an open area (rooms bounded
 * by walls follow their walls and get none, see boundingWalls). Dragging a corner moves it, snapped
 * like the drawing tools (Alt: no grid, Shift: no 45° lines), as one undo step; a move that would
 * make the outline cross itself or collapse an edge is refused and the corner stays at the last
 * place that worked. A double-click on an edge adds a corner there, and Delete or Backspace with
 * the pointer on a corner removes it (at least three stay).
 */
export function RoomCorners({
  room,
  walls,
  scale,
  shiftRef,
  onDragging,
}: {
  room: Room
  walls: Wall[]
  scale: number
  shiftRef: React.RefObject<boolean>
  /** Called with true when a corner drag starts and false when it ends. */
  onDragging(dragging: boolean): void
}) {
  // The outline as it was when the drag started (every move is worked out from it), and where the
  // dragged corner last stood in a valid outline
  const dragRef = useRef<{ base: Vec2[]; last: Vec2 } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  /** The corner under the pointer, which Delete removes. */
  const hoverRef = useRef<number | null>(null)
  const hit = useHitSizes()
  const poly = room.polygon

  // A drag cut short by unmounting (undo, a variant switch) must not leave the plan thinking it goes on
  useEffect(() => () => onDragging(false), [onDragging])

  // Delete/Backspace over a corner removes that corner and never the whole room. Listens in the
  // capture phase, before the editor's shortcut that deletes the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || hoverRef.current === null || dragRef.current) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      e.preventDefault()
      e.stopImmediatePropagation()
      const next = removeVertex(room.polygon, hoverRef.current)
      hoverRef.current = null
      if (next) useStore.getState().setRoomPolygon(room.id, next)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [room.id, room.polygon])

  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    return (
      <Line
        key={`${a.x}:${a.y}:${b.x}:${b.y}`}
        name="room-edge"
        points={[a.x, a.y, b.x, b.y]}
        stroke="transparent"
        hitStrokeWidth={hit.line}
        strokeScaleEnabled={false}
        onMouseEnter={(e) => setCursor(e, 'copy')}
        onMouseLeave={(e) => setCursor(e, '')}
        onPointerClick={(e) => {
          e.cancelBubble = true
          if (isAdditive(e.evt)) useStore.getState().pick({ kind: 'room', id: room.id }, true)
        }}
        onPointerDblClick={(e) => {
          e.cancelBubble = true
          const p = e.target.getStage()?.getRelativePointerPosition()
          if (!p) return
          const next = insertVertex(poly, i, closestPointOnSegment(p, a, b).point)
          if (next) useStore.getState().setRoomPolygon(room.id, next)
        }}
      />
    )
  })

  const handles = poly.map((p, i) => (
    <Circle
      // A corner has no id of its own, and its position changes while it is dragged: keyed by
      // position the handle would be replaced under the pointer and the drag would stop
      // eslint-disable-next-line @eslint-react/no-array-index-key -- see above
      key={`corner-${i}`}
      name="room-corner"
      x={p.x}
      y={p.y}
      radius={hit.handle / scale}
      fill="#fff"
      stroke="#2563eb"
      strokeWidth={2}
      hitStrokeWidth={handleHitStroke(hit.handle, hit.handleHit)}
      strokeScaleEnabled={false}
      draggable
      onMouseEnter={(e) => {
        hoverRef.current = i
        setCursor(e, 'move')
      }}
      onMouseLeave={(e) => {
        if (hoverRef.current === i) hoverRef.current = null
        setCursor(e, '')
      }}
      onDragStart={() => {
        beginGesture()
        dragRef.current = { base: poly, last: p }
        setDragging(i)
        onDragging(true)
      }}
      onDragMove={(e) => {
        const drag = dragRef.current
        if (!drag) return
        const n = drag.base.length
        const r = snapCorner(
          { x: e.target.x(), y: e.target.y() },
          drag.base[(i - 1 + n) % n]!,
          drag.base[(i + 1) % n]!,
          {
            walls,
            tolerance: hit.snap / scale,
            ortho: !isFreeAngle(shiftRef.current),
            grid: isNoGrid(e.evt) ? undefined : SNAP_GRID,
          },
        )
        const next = moveVertex(drag.base, i, r.point)
        if (next) {
          drag.last = r.point
          useStore.getState().setRoomPolygon(room.id, next)
        }
        e.target.position(drag.last)
      }}
      onDragEnd={() => {
        dragRef.current = null
        setDragging(null)
        onDragging(false)
        endGesture()
      }}
    />
  ))

  const dragged = dragging !== null ? poly[dragging] : undefined
  return (
    <>
      {edges}
      {handles}
      {dragged && (
        <Label
          at={{ x: dragged.x, y: dragged.y - 8 / scale }}
          text={fmtM2(polygonArea(poly))}
          scale={scale}
          color="#2563eb"
        />
      )}
    </>
  )
}
