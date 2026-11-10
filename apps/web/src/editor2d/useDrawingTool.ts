import { useEffect, useRef, useState, type RefObject } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { dist, nearestWall, snapPoint, type SnapKind, type Vec2, type Wall } from '@romslig/shared'
import { useStore, type Tool } from '../store.ts'
import { fixturePlacement } from './installationUtils.ts'
import type { PlanView } from './Plan2D.tsx'

export interface DrawingToolOptions {
  stageRef: RefObject<Konva.Stage | null>
  /** The effective tool ('select' in read-only mode). */
  tool: Tool
  readOnly: boolean
  walls: Wall[]
  /** Current stage scale (screen px per meter); sets the snap tolerance. */
  scale: number
  /** Image pixels per meter, for calibration. */
  ppm: number
  setManualView(v: PlanView | null): void
}

export interface DrawingTool {
  cursor: { p: Vec2; kind: SnapKind } | null
  setCursor(c: { p: Vec2; kind: SnapKind } | null): void
  /** Start point of the wall being drawn. */
  anchor: Vec2 | null
  /** Points of the room / lowered ceiling / run being drawn. */
  roomPts: Vec2[]
  /** Calibration points picked so far. */
  calPts: Vec2[]
  /** True while Shift is held (free angle / no snapping). */
  shiftRef: RefObject<boolean>
  onMouseMove(): void
  onClick(e: KonvaEventObject<MouseEvent>): void
  /** Finishes the current wall chain, room, ceiling or run. */
  endChain(): void
}

/** State and pointer handlers for the drawing tools (walls, rooms, openings, fixtures, runs, calibration). */
export function useDrawingTool({
  stageRef,
  tool,
  readOnly,
  walls,
  scale,
  ppm,
  setManualView,
}: DrawingToolOptions): DrawingTool {
  const { select, addWall, addOpening, addRoom, calibrate, setTool } = useStore.getState()
  const [cursor, setCursor] = useState<{ p: Vec2; kind: SnapKind } | null>(null)
  const [anchor, setAnchor] = useState<Vec2 | null>(null)
  const [roomPts, setRoomPts] = useState<Vec2[]>([])
  const [calPts, setCalPts] = useState<Vec2[]>([])
  const shiftRef = useRef(false)
  /** Our own double-click detection: same spot (screen px) within 350 ms. */
  const lastClickRef = useRef({ t: 0, x: 0, y: 0, double: false })

  // Reset in-progress drawing when the tool changes (adjusting state during render, not in an effect)
  const [draftTool, setDraftTool] = useState(tool)
  if (draftTool !== tool) {
    setDraftTool(tool)
    setAnchor(null)
    setRoomPts([])
    setCalPts([])
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey
      if (e.key === 'Escape') {
        setAnchor(null)
        setRoomPts([])
        setCalPts([])
      }
    }
    const up = (e: KeyboardEvent) => (shiftRef.current = e.shiftKey)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const px = (n: number) => n / scale // screen pixels → meters
  const tol = px(12)

  const worldPointer = (): Vec2 | null => stageRef.current?.getRelativePointerPosition() ?? null

  const resolve = (p: Vec2): { p: Vec2; kind: SnapKind } => {
    if (tool === 'wall') {
      const r = snapPoint(p, { walls, anchor, tolerance: tol, ortho: !shiftRef.current })
      return { p: r.point, kind: r.kind }
    }
    if (tool === 'room' || tool === 'ceiling' || tool === 'run') {
      if (tool !== 'run' && roomPts.length >= 3 && dist(p, roomPts[0]!) < tol)
        return { p: roomPts[0]!, kind: 'endpoint' }
      const r = snapPoint(p, { walls, anchor: roomPts.at(-1), tolerance: tol, ortho: !shiftRef.current })
      return { p: r.point, kind: r.kind }
    }
    return { p, kind: 'none' }
  }

  const onMouseMove = () => {
    const p = worldPointer()
    if (p) setCursor(resolve(p))
  }

  const onClick = (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0 || readOnly) return
    const raw = worldPointer()
    if (!raw) return
    const now = performance.now()
    const sameSpot =
      now - lastClickRef.current.t < 350 &&
      Math.hypot(e.evt.clientX - lastClickRef.current.x, e.evt.clientY - lastClickRef.current.y) < 6
    const wasDouble = lastClickRef.current.double
    lastClickRef.current = { t: now, x: e.evt.clientX, y: e.evt.clientY, double: sameSpot && !wasDouble }
    if (sameSpot && (tool === 'wall' || tool === 'room' || tool === 'run' || tool === 'ceiling')) {
      // 2nd click finishes the chain; a 3rd quick click on the same spot is ignored
      if (!wasDouble) endChain()
      return
    }
    const { p } = resolve(raw)
    switch (tool) {
      case 'select':
        if (e.target === e.target.getStage() || e.target.name() === 'bg') select(null)
        break
      case 'wall':
        if (anchor && dist(anchor, p) > 0.05) addWall(anchor, p)
        setAnchor(p)
        break
      case 'door':
      case 'window':
      case 'opening': {
        const hit = nearestWall(raw, walls, tol * 2)
        if (hit) addOpening(tool, hit.wall.id, hit.offset)
        break
      }
      case 'room':
      case 'ceiling':
        if (roomPts.length >= 3 && dist(p, roomPts[0]!) < 1e-6) {
          if (tool === 'room') addRoom(roomPts)
          else useStore.getState().addLoweredCeiling(roomPts)
          setRoomPts([])
        } else setRoomPts([...roomPts, p])
        break
      case 'run':
        if (!roomPts.length || dist(p, roomPts.at(-1)!) > 0.02) setRoomPts([...roomPts, p])
        break
      case 'fixture': {
        const { fixtureKind } = useStore.getState()
        const placed = fixturePlacement(raw, walls, tol * 2, fixtureKind)
        useStore.getState().addFixture(fixtureKind, placed.point, placed.wallId)
        break
      }
      case 'calibrate': {
        const pts = [...calPts, raw]
        if (pts.length < 2) return setCalPts(pts)
        setCalPts(pts)
        const input = window.prompt('Hvor langt er dette i virkeligheten? (meter, f.eks. 3,6)')
        const meters = input ? parseFloat(input.replace(',', '.')) : NaN
        if (meters > 0) {
          calibrate(dist(pts[0]!, pts[1]!) * ppm, meters)
          setManualView(null) // refit to the rescaled drawing
          setTool('select')
        }
        setCalPts([])
        break
      }
    }
  }

  const endChain = () => {
    setAnchor(null)
    if (tool === 'room' && roomPts.length >= 3) addRoom(roomPts)
    if (tool === 'ceiling' && roomPts.length >= 3) useStore.getState().addLoweredCeiling(roomPts)
    if (tool === 'run' && roomPts.length >= 2) useStore.getState().addRun(roomPts)
    setRoomPts([])
  }

  return { cursor, setCursor, anchor, roomPts, calPts, shiftRef, onMouseMove, onClick, endChain }
}
