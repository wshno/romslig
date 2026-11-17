import { useEffect, useRef, useState, type RefObject } from 'react'
import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { add, dist, mul, nearestWall, norm, snapPoint, sub, type SnapKind, type Vec2, type Wall } from '@romslig/shared'
import { useStore, type Tool } from '../store.ts'
import { useHitSizes } from './hit.ts'
import { fixturePlacement } from './installationUtils.ts'
import type { Measurement } from './measure.ts'
import { isAdditive, isFreeAngle, isNoGrid } from './modifiers.ts'
import type { PlanView } from './Plan2D.tsx'
import { SNAP_GRID } from './planStyle.ts'
import { MIN_TYPED_LENGTH, parseLength, typedWallEnd } from './wallLength.ts'

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
  /** The measuring tool's measurement: temporary, never stored in the project. */
  measurement: Measurement | null
  /** What has been typed as the length of the wall being drawn (e.g. "3,2"), or null. */
  typedLength: string | null
  /** Sets that length: the DrawBar's field edits the same text the keyboard does. */
  setTypedLength(text: string | null): void
  /** Places the wall being drawn at the typed length (Enter, or the DrawBar's «Sett»); false if there is none. */
  commitTypedLength(): boolean
  /** Where the wall being drawn ends: the typed length toward the pointer, else the pointer. */
  wallEnd: Vec2 | null
  /** True while Shift is held (free angle / no snapping). */
  shiftRef: RefObject<boolean>
  /** Two calibration points are picked: the real distance between them is asked for (CalibrateDialog). */
  calibrating: boolean
  /** Answers the calibration question: the distance in metres, or null to give up. */
  finishCalibration(meters: number | null): void
  /** Removes the measuring tool's measurement and stays in the tool. */
  clearMeasurement(): void
  onPointerDown(e: KonvaEventObject<PointerEvent>): void
  onPointerMove(e?: KonvaEventObject<PointerEvent>): void
  onPointerUp(e: KonvaEventObject<PointerEvent>): void
  onPointerClick(e: KonvaEventObject<PointerEvent>): void
  /** Finishes the current wall chain, room, ceiling or run. */
  endChain(): void
}

/**
 * State and pointer handlers for the drawing tools (walls, rooms, openings, fixtures, runs, calibration).
 *
 * A mouse or pen places a point with a click; the aim follows it as it hovers. A finger cannot
 * hover, so the aim follows it while it is held down and the point goes where it is lifted: the
 * snap and the length show before it is placed. Konva fires no click after a finger has moved
 * (the stage's drag start cancels it, see Plan2D), hence onPointerUp for touch.
 */
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
  const [measurement, setMeasurement] = useState<Measurement | null>(null)
  const [typedLength, setTypedLength] = useState<string | null>(null)
  /** Direction of the last wall placed in this chain: a typed length goes on straight ahead from it. */
  const [chainDir, setChainDir] = useState<Vec2 | null>(null)
  const shiftRef = useRef(false)
  /** True while Alt is held (no grid snapping). */
  const altRef = useRef(false)
  /** Our own double-click detection: same spot (screen px, see sameSpotPx) within 350 ms. */
  const lastClickRef = useRef({ t: 0, x: 0, y: 0, double: false })

  // Reset in-progress drawing when the tool changes (adjusting state during render, not in an effect)
  const [draftTool, setDraftTool] = useState(tool)
  if (draftTool !== tool) {
    setDraftTool(tool)
    setTypedLength(null)
    setChainDir(null)
    setAnchor(null)
    setRoomPts([])
    setCalPts([])
    setMeasurement(null)
  }

  // The editor's Escape shortcut needs to know whether something is being drawn. A measurement
  // counts too, also a finished one, so Escape clears it like it ends a wall.
  const inProgress = anchor !== null || roomPts.length > 0 || calPts.length > 0 || measurement !== null
  useEffect(() => {
    useStore.getState().setDrawing(inProgress)
  }, [inProgress])
  useEffect(() => () => useStore.getState().setDrawing(false), [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey
      altRef.current = e.altKey
      if (e.key === 'Escape') {
        setTypedLength(null)
        setChainDir(null)
        setAnchor(null)
        setRoomPts([])
        setCalPts([])
        setMeasurement(null)
      }
    }
    const up = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey
      altRef.current = e.altKey
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const hit = useHitSizes()
  const px = (n: number) => n / scale // screen pixels → meters
  const tol = px(hit.snap)

  const worldPointer = (): Vec2 | null => stageRef.current?.getRelativePointerPosition() ?? null

  const resolve = (p: Vec2): { p: Vec2; kind: SnapKind } => {
    // The keys, or for a finger the DrawBar's «Uten rutenett» and «Fri vinkel»
    const grid = isNoGrid({ altKey: altRef.current }) ? undefined : SNAP_GRID
    const ortho = !isFreeAngle(shiftRef.current)
    if (tool === 'wall') {
      const r = snapPoint(p, { walls, anchor, tolerance: tol, ortho, grid })
      return { p: r.point, kind: r.kind }
    }
    if (tool === 'room' || tool === 'ceiling' || tool === 'run') {
      if (tool !== 'run' && roomPts.length >= 3 && dist(p, roomPts[0]!) < tol)
        return { p: roomPts[0]!, kind: 'endpoint' }
      const r = snapPoint(p, { walls, anchor: roomPts.at(-1), tolerance: tol, ortho, grid })
      return { p: r.point, kind: r.kind }
    }
    if (tool === 'measure') {
      // Like the wall tool, with 45° steps from the first point while the second is picked
      const from = measurement && !measurement.b ? measurement.a : undefined
      const r = snapPoint(p, { walls, anchor: from, tolerance: tol, ortho, grid })
      return { p: r.point, kind: r.kind }
    }
    return { p, kind: 'none' }
  }

  // Length typed while drawing a wall: digits and a decimal comma, Enter places the end that far
  // toward the pointer. Listens in the capture phase, before the editor's shortcuts (Backspace
  // deletes, Escape leaves the tool), and keeps those keys while a length is being typed. The
  // DrawBar's length field edits the same text, and its «Sett» does what Enter does.
  const typedMeters = parseLength(typedLength)
  let wallEnd: Vec2 | null = null
  if (tool === 'wall' && anchor)
    wallEnd = typedWallEnd(anchor, cursor?.p ?? null, typedMeters, chainDir) ?? cursor?.p ?? null

  /** Ends the wall being drawn at `end`, and the next one starts there. */
  const placeWall = (from: Vec2, end: Vec2) => {
    if (dist(from, end) > MIN_TYPED_LENGTH) {
      addWall(from, end)
      setChainDir(norm(sub(end, from)))
    }
    setAnchor(end)
    setTypedLength(null)
  }

  const commitTypedLength = (): boolean => {
    const longEnough = typedMeters > MIN_TYPED_LENGTH // NaN (nothing typed) is not
    if (tool !== 'wall' || !anchor || readOnly || !longEnough) return false
    const end = typedWallEnd(anchor, cursor?.p ?? null, typedMeters, chainDir)
    if (!end) return false
    placeWall(anchor, end)
    return true
  }

  // Attached again on every render: it acts on the length and the aim as they are now
  useEffect(() => {
    if (tool !== 'wall' || !anchor || readOnly) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const take = () => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (/^\d$/.test(e.key) || ((e.key === ',' || e.key === '.') && !/[.,]/.test(typedLength ?? ''))) {
        take()
        setTypedLength((typedLength ?? '') + (e.key === '.' ? ',' : e.key))
      } else if (typedLength !== null && e.key === 'Backspace') {
        take()
        setTypedLength(typedLength.length > 1 ? typedLength.slice(0, -1) : null)
      } else if (typedLength !== null && e.key === 'Escape') {
        take() // the first Escape drops what was typed, the next one ends the wall
        setTypedLength(null)
      } else if (typedLength !== null && e.key === 'Enter') {
        take()
        commitTypedLength()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const onPointerMove = (e?: KonvaEventObject<PointerEvent>) => {
    // The pointer event knows Alt too, and is right even when its keyup was missed (Alt+Tab)
    if (e) altRef.current = e.evt.altKey
    const p = worldPointer()
    if (p) setCursor(resolve(p))
  }

  const fingerDrawing = (e: KonvaEventObject<PointerEvent>) => e.evt.pointerType === 'touch' && tool !== 'select'

  // A finger shows the aim from the moment it touches
  const onPointerDown = (e: KonvaEventObject<PointerEvent>) => {
    if (fingerDrawing(e)) onPointerMove(e)
  }

  const onPointerUp = (e: KonvaEventObject<PointerEvent>) => {
    if (!fingerDrawing(e)) return
    // Lifted at the end of a drag of a handle (a selected wall's ends): that was no point
    if (Konva.DD.isDragging) return
    onPointerMove(e)
    place(e)
  }

  const onPointerClick = (e: KonvaEventObject<PointerEvent>) => {
    if (fingerDrawing(e)) return // placed in onPointerUp
    place(e)
  }

  const place = (e: KonvaEventObject<PointerEvent>) => {
    // While the calibration question is open, the plan waits for its answer
    if (e.evt.button !== 0 || readOnly || calPts.length >= 2) return
    altRef.current = e.evt.altKey
    const raw = worldPointer()
    if (!raw) return
    const now = performance.now()
    // Two taps of a finger land further apart than two clicks of a mouse
    const sameSpotPx = e.evt.pointerType === 'touch' ? 20 : 6
    const sameSpot =
      now - lastClickRef.current.t < 350 &&
      Math.hypot(e.evt.clientX - lastClickRef.current.x, e.evt.clientY - lastClickRef.current.y) < sameSpotPx
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
        // A click on empty space lets go of the selection; adding to it (Shift, «Velg flere») keeps it
        if ((e.target === e.target.getStage() || e.target.name() === 'bg') && !isAdditive(e.evt)) select(null)
        break
      case 'wall': {
        // With a length typed, a click places the wall at that length toward the click
        const end =
          anchor && typedMeters > 0 && dist(anchor, p) > 1e-6 ? add(anchor, mul(norm(sub(p, anchor)), typedMeters)) : p
        if (anchor) placeWall(anchor, end)
        else {
          setAnchor(end)
          setTypedLength(null)
        }
        break
      }
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
      case 'measure':
        // A click after a finished measurement starts a new one
        if (!measurement || measurement.b) setMeasurement({ a: p, b: null })
        else if (dist(measurement.a, p) > 1e-6) setMeasurement({ a: measurement.a, b: p })
        break
      case 'calibrate':
        // The second point opens the question for the real distance (see finishCalibration)
        setCalPts([...calPts, raw])
        break
    }
  }

  const finishCalibration = (meters: number | null) => {
    const [a, b] = calPts
    if (a && b && meters !== null && meters > 0) {
      calibrate(dist(a, b) * ppm, meters)
      setManualView(null) // refit to the rescaled drawing
      setTool('select')
    }
    setCalPts([])
  }

  const endChain = () => {
    setAnchor(null)
    setChainDir(null)
    setTypedLength(null)
    if (tool === 'room' && roomPts.length >= 3) addRoom(roomPts)
    if (tool === 'ceiling' && roomPts.length >= 3) useStore.getState().addLoweredCeiling(roomPts)
    if (tool === 'run' && roomPts.length >= 2) useStore.getState().addRun(roomPts)
    setRoomPts([])
  }

  return {
    cursor,
    setCursor,
    anchor,
    roomPts,
    calPts,
    measurement,
    typedLength,
    setTypedLength,
    commitTypedLength,
    wallEnd,
    shiftRef,
    calibrating: tool === 'calibrate' && calPts.length >= 2,
    finishCalibration,
    clearMeasurement: () => setMeasurement(null),
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerClick,
    endChain,
  }
}
