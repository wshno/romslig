import { useRef } from 'react'
import { Circle, Group, Line, Rect, Text } from 'react-konva'
import {
  add,
  clearanceZones,
  frontDir,
  getCatalogItem,
  itemSize,
  mul,
  type FurnitureIssue,
  type FurnitureItem,
} from '@romslig/shared'
import { activeScenario, beginGesture, endGesture, useStore } from '../store.ts'
import { isSelected, selectedIds } from '../selection.ts'

const ROTATE_HANDLE_GAP = 0.35

interface Props {
  item: FurnitureItem
  issues: FurnitureIssue[] | undefined
  selected: boolean
  /** It is the only thing selected: it gets the rotation handle. */
  alone: boolean
  interactive: boolean
  scale: number
  shiftRef: React.RefObject<boolean>
}

/**
 * A furniture item in plan view: footprint, front edge, label, free-space zones and handles.
 *
 * A press selects it alone, or with Shift toggles it in the selection. A press on an item that is
 * already selected keeps the selection, so dragging it moves every selected furniture item along
 * (one undo step, without wall snapping); a click without dragging then selects it alone. Dragged
 * alone, it snaps to walls as before (Shift: no snapping).
 */
export function Furniture2D({ item, issues, selected, alone, interactive, scale, shiftRef }: Props) {
  const { pick, moveFurniture, updateFurniture } = useStore.getState()
  // The furniture as it stood when a group drag started, and where this item was then
  const groupRef = useRef<{ base: FurnitureItem[]; from: { x: number; y: number } } | null>(null)
  const cat = getCatalogItem(item.catalogId)
  const { w, d } = itemSize(item, cat)
  const hasIssues = Boolean(issues?.length)
  const blockedSides = new Set(issues?.flatMap((i) => (i.kind === 'clearance' ? [i.side] : [])))
  const showZones = selected || blockedSides.size > 0
  const isRug = cat.shape === 'rug'
  const stroke = (() => {
    if (hasIssues) return '#dc2626'
    if (selected) return '#2563eb'
    return '#334155'
  })()
  const label = item.label ?? cat.name
  const fits = w * scale > 40 && d * scale > 14
  const front = frontDir(item.rotation)
  const handleAt = add({ x: item.x, y: item.y }, mul(front, d / 2 + ROTATE_HANDLE_GAP))

  return (
    <>
      {showZones &&
        clearanceZones(item, cat).map((z) => (
          <Line
            key={z.side}
            points={z.poly.flatMap((p) => [p.x, p.y])}
            closed
            fill={blockedSides.has(z.side) ? '#fecaca' : '#dbeafe'}
            opacity={0.55}
            stroke={blockedSides.has(z.side) ? '#dc2626' : '#60a5fa'}
            strokeWidth={1}
            dash={[4, 3]}
            strokeScaleEnabled={false}
            listening={false}
          />
        ))}
      <Group
        x={item.x}
        y={item.y}
        rotation={item.rotation}
        draggable={interactive}
        onMouseDown={(e) => {
          if (!interactive) return
          e.cancelBubble = true
          const shift = e.evt.shiftKey
          if (shift || !isSelected(useStore.getState().selection, item.id))
            pick({ kind: 'furniture', id: item.id }, shift)
        }}
        onClick={(e) => {
          if (!interactive) return
          e.cancelBubble = true
          // A click (no drag) on one of several selected items selects it alone
          const { selection } = useStore.getState()
          if (!e.evt.shiftKey && selection.length > 1) pick({ kind: 'furniture', id: item.id }, false)
        }}
        onDragStart={(e) => {
          e.cancelBubble = true
          const { selection, project } = useStore.getState()
          // Shift+press took it out of the selection: nothing to drag
          if (!isSelected(selection, item.id) || !project) {
            e.target.stopDrag()
            return
          }
          const ids = new Set(selectedIds(selection, 'furniture'))
          groupRef.current =
            ids.size > 1
              ? { base: activeScenario(project).furniture.filter((f) => ids.has(f.id)), from: { x: item.x, y: item.y } }
              : null
          beginGesture()
        }}
        onDragMove={(e) => {
          e.cancelBubble = true
          const group = groupRef.current
          if (group) {
            const delta = { x: e.target.x() - group.from.x, y: e.target.y() - group.from.y }
            useStore.getState().moveFurnitureGroup(group.base, delta)
            return
          }
          moveFurniture(item.id, { x: e.target.x(), y: e.target.y() }, !shiftRef.current)
          const moved = useStore
            .getState()
            .project?.scenarios.flatMap((s) => s.furniture)
            .find((f) => f.id === item.id)
          if (moved) {
            e.target.position({ x: moved.x, y: moved.y })
            e.target.rotation(moved.rotation)
          }
        }}
        onDragEnd={(e) => {
          e.cancelBubble = true
          groupRef.current = null
          endGesture()
        }}
      >
        <Rect
          x={-w / 2}
          y={-d / 2}
          width={w}
          height={d}
          fill={cat.color}
          opacity={isRug ? 0.45 : 0.92}
          stroke={stroke}
          strokeWidth={selected || hasIssues ? 2 : 1}
          dash={isRug ? [6, 4] : undefined}
          strokeScaleEnabled={false}
          cornerRadius={Math.min(w, d) * 0.06}
        />
        {/* Front edge */}
        {!isRug && (
          <Line
            points={[-w / 2, d / 2, w / 2, d / 2]}
            stroke={stroke}
            strokeWidth={3}
            strokeScaleEnabled={false}
            listening={false}
          />
        )}
      </Group>
      {fits && (
        <Text
          x={item.x - w / 2}
          y={item.y - 6 / scale}
          width={w}
          align="center"
          text={label}
          fontSize={10 / scale}
          fill="#0f172a"
          ellipsis
          wrap="none"
          listening={false}
        />
      )}
      {alone && interactive && !isRug && (
        <Circle
          x={handleAt.x}
          y={handleAt.y}
          radius={6 / scale}
          fill="#fff"
          stroke="#2563eb"
          strokeWidth={2}
          strokeScaleEnabled={false}
          draggable
          onMouseDown={(e) => (e.cancelBubble = true)}
          onDragStart={(e) => {
            e.cancelBubble = true
            beginGesture()
          }}
          onDragMove={(e) => {
            e.cancelBubble = true
            const dx = e.target.x() - item.x
            const dy = e.target.y() - item.y
            let rotation = (Math.atan2(-dx, dy) * 180) / Math.PI
            if (!shiftRef.current) rotation = Math.round(rotation / 15) * 15
            rotation = ((rotation % 360) + 360) % 360
            updateFurniture(item.id, { rotation })
            e.target.position(add({ x: item.x, y: item.y }, mul(frontDir(rotation), d / 2 + ROTATE_HANDLE_GAP)))
          }}
          onDragEnd={(e) => {
            e.cancelBubble = true
            endGesture()
          }}
        />
      )}
    </>
  )
}
