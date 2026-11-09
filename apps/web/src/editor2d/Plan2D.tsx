import { useEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Arc, Circle, Group, Image as KImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  add,
  areaDeviation,
  furnitureIssues,
  clampOpening,
  dist,
  mul,
  nearestWall,
  norm,
  polygonArea,
  signedArea,
  polygonCentroid,
  snapPoint,
  sub,
  wallDir,
  wallLength,
  type Opening,
  type Room,
  type Scenario,
  type SnapKind,
  type Vec2,
  type Wall,
} from '@romslig/shared'
import { api } from '../api.ts'
import { activeScenario, beginGesture, endGesture, useStore } from '../store.ts'
import { Furniture2D } from './Furniture2D.tsx'
import { FURNITURE_DND_TYPE } from '../dnd.ts'
import { ROOM_COLORS, fmtM, fmtM2 } from '../theme.ts'

Konva.dragButtons = [0, 1]

function useHtmlImage(src: string | null) {
  const [loaded, setLoaded] = useState<{ src: string; img: HTMLImageElement } | null>(null)
  useEffect(() => {
    if (!src) return
    const i = new window.Image()
    i.onload = () => setLoaded({ src, img: i })
    i.src = src
  }, [src])
  // Only return the image that belongs to the current src
  return loaded && loaded.src === src ? loaded.img : null
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e!.contentRect.width, height: e!.contentRect.height }))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

const SNAP_COLORS: Record<SnapKind, string> = {
  endpoint: '#e11d48',
  wall: '#f59e0b',
  angle: '#2563eb',
  none: '#64748b',
}

function wallFill(w: Wall, selected: boolean): string {
  if (selected) return '#2563eb'
  return w.loadBearing === 'yes' ? '#7f1d1d' : '#1f2937'
}

const OPENING_COLORS: Record<Opening['kind'], string> = { door: '#92400e', window: '#0891b2', opening: '#6b7280' }

function wallQuad(w: Pick<Wall, 'a' | 'b' | 'thickness'>): number[] {
  const d = wallDir(w)
  const n = { x: -d.y * (w.thickness / 2), y: d.x * (w.thickness / 2) }
  const pts = [add(w.a, n), add(w.b, n), sub(w.b, n), sub(w.a, n)]
  return pts.flatMap((p) => [p.x, p.y])
}

export type PlanView = { scale: number; x: number; y: number }

interface Plan2DProps {
  /** Variant to show; defaults to the active one. */
  scenarioId?: string
  /** Comparison mode: no editing, only panning and zooming. */
  readOnly?: boolean
  /** Highlights walls that differ from this variant (removed: red dashed, new: green). */
  compareWith?: Scenario | null
  /** Shared pan/zoom, so two plans move together. null = fit to the container. */
  sharedView?: { value: PlanView | null; set(v: PlanView | null): void }
  title?: string
}

export function Plan2D({ scenarioId, readOnly = false, compareWith = null, sharedView, title }: Plan2DProps = {}) {
  const [containerRef, size] = useSize<HTMLDivElement>()
  const stageRef = useRef<Konva.Stage>(null)
  const project = useStore((s) => s.project)!
  const scenario = project.scenarios.find((sc) => sc.id === scenarioId) ?? activeScenario(project)
  const store = useStore()
  const tool = readOnly ? 'select' : store.tool
  const selection = readOnly ? null : store.selection
  const suggestion = readOnly ? null : store.suggestion
  const interactive = !readOnly && tool === 'select'
  const { select, addWall, addOpening, addRoom, updateWall, updateOpening, calibrate, setTool } = useStore.getState()

  const img = useHtmlImage(project.planImage ? `${api.planUrl(project.id)}?v=${project.createdAt}` : null)
  const ppm = project.calibration.pxPerMeter
  const imgW = project.planImage ? project.planImage.width / ppm : 15
  const imgH = project.planImage ? project.planImage.height / ppm : 10

  /** null = fit the drawing to the container */
  const [ownView, setOwnView] = useState<PlanView | null>(null)
  const manualView = sharedView ? sharedView.value : ownView
  const setManualView = sharedView ? sharedView.set : setOwnView
  const [cursor, setCursor] = useState<{ p: Vec2; kind: SnapKind } | null>(null)
  const [anchor, setAnchor] = useState<Vec2 | null>(null)
  const [roomPts, setRoomPts] = useState<Vec2[]>([])
  const [calPts, setCalPts] = useState<Vec2[]>([])
  const [imgOpacity, setImgOpacity] = useState(0.6)
  const [showDims, setShowDims] = useState(true)
  const issues = useMemo(() => furnitureIssues(scenario), [scenario])
  const shiftRef = useRef(false)
  const lastButtonRef = useRef(0)
  /** Our own double-click detection: same spot (screen px) within 350 ms. */
  const lastClickRef = useRef({ t: 0, x: 0, y: 0, double: false })

  const fitView = useMemo(() => {
    if (size.width < 50) return null
    const scale = Math.min(size.width / imgW, size.height / imgH) * 0.92
    return { scale, x: (size.width - imgW * scale) / 2, y: (size.height - imgH * scale) / 2 }
  }, [size, imgW, imgH])
  const view = manualView ?? fitView

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

  const scale = view?.scale ?? 40
  const px = (n: number) => n / scale // screen pixels → meters
  const tol = px(12)
  const walls = scenario.walls

  const worldPointer = (): Vec2 | null => stageRef.current?.getRelativePointerPosition() ?? null

  const resolve = (p: Vec2): { p: Vec2; kind: SnapKind } => {
    if (tool === 'wall') {
      const r = snapPoint(p, { walls, anchor, tolerance: tol, ortho: !shiftRef.current })
      return { p: r.point, kind: r.kind }
    }
    if (tool === 'room') {
      if (roomPts.length >= 3 && dist(p, roomPts[0]!) < tol) return { p: roomPts[0]!, kind: 'endpoint' }
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
    if (sameSpot && (tool === 'wall' || tool === 'room')) {
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
        if (roomPts.length >= 3 && dist(p, roomPts[0]!) < 1e-6) {
          addRoom(roomPts)
          setRoomPts([])
        } else setRoomPts([...roomPts, p])
        break
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
    if (tool === 'room' && roomPts.length >= 3) {
      addRoom(roomPts)
      setRoomPts([])
    }
  }

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage || !view) return
    const pointer = stage.getPointerPosition()!
    const world = { x: (pointer.x - view.x) / view.scale, y: (pointer.y - view.y) / view.scale }
    const factor = e.evt.deltaY > 0 ? 1 / 1.12 : 1.12
    const ns = Math.min(800, Math.max(5, view.scale * factor))
    setManualView({ scale: ns, x: pointer.x - world.x * ns, y: pointer.y - world.y * ns })
  }

  const selectedWall = selection?.kind === 'wall' ? walls.find((w) => w.id === selection.id) : undefined
  const crosshair = tool !== 'select'

  return (
    <div
      ref={containerRef}
      className="plan2d"
      style={{ cursor: crosshair ? 'crosshair' : 'default' }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(FURNITURE_DND_TYPE)) e.preventDefault()
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(FURNITURE_DND_TYPE)
        const stage = stageRef.current
        if (!id || !stage || readOnly) return
        e.preventDefault()
        stage.setPointersPositions(e.nativeEvent)
        const p = stage.getRelativePointerPosition()
        if (p) useStore.getState().addFurniture(id, p, { snap: !e.shiftKey })
        useStore.getState().setTool('select')
      }}
    >
      {view && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable
          onMouseDown={(e) => (lastButtonRef.current = e.evt.button)}
          onDragStart={(e) => {
            if (e.target === stageRef.current && tool !== 'select' && lastButtonRef.current === 0) e.target.stopDrag()
          }}
          onDragEnd={(e) => {
            if (e.target === stageRef.current) setManualView({ scale: view.scale, x: e.target.x(), y: e.target.y() })
          }}
          onWheel={onWheel}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setCursor(null)}
          onClick={onClick}
          onContextMenu={(e) => {
            e.evt.preventDefault()
            endChain()
          }}
        >
          <Layer>
            <Rect name="bg" x={-200} y={-200} width={400 + imgW} height={400 + imgH} fill="#f8fafc" />
            {img ? (
              <KImage name="bg" image={img} width={imgW} height={imgH} opacity={imgOpacity} />
            ) : (
              <Grid w={imgW} h={imgH} />
            )}
          </Layer>
          <Layer>
            {scenario.rooms.map((r) => (
              <RoomShape
                key={r.id}
                room={r}
                scale={scale}
                selected={selection?.id === r.id}
                interactive={interactive}
              />
            ))}
            {walls.map((w) => (
              <Line
                key={w.id}
                points={wallQuad(w)}
                closed
                fill={wallFill(w, selection?.id === w.id)}
                opacity={0.9}
                hitStrokeWidth={8}
                strokeScaleEnabled={false}
                onClick={(e) => {
                  if (!interactive) return
                  e.cancelBubble = true
                  select({ kind: 'wall', id: w.id })
                }}
              />
            ))}
            {compareWith && <WallDiff current={scenario} other={compareWith} />}
            {scenario.openings.map((o) => {
              const w = walls.find((x) => x.id === o.wallId)
              return w ? (
                <OpeningShape
                  key={o.id}
                  o={o}
                  wall={w}
                  scale={scale}
                  selected={selection?.id === o.id}
                  interactive={interactive}
                  onSelect={() => select({ kind: 'opening', id: o.id })}
                  onMove={(offset) => updateOpening(o.id, { offset })}
                />
              ) : null
            })}
            {scenario.furniture.map((f) => (
              <Furniture2D
                key={f.id}
                item={f}
                issues={issues.get(f.id)}
                selected={selection?.id === f.id}
                interactive={interactive}
                scale={scale}
                shiftRef={shiftRef}
              />
            ))}
            {showDims && scenario.rooms.map((r) => <RoomEdgeLengths key={`dim-${r.id}`} room={r} scale={scale} />)}
            {selectedWall && (
              <WallHandles
                wall={selectedWall}
                walls={walls}
                scale={scale}
                shiftRef={shiftRef}
                updateWall={updateWall}
              />
            )}
            {suggestion && <SuggestionOverlay scale={scale} />}

            {/* Tool previews */}
            {tool === 'wall' && anchor && cursor && (
              <>
                <Line
                  points={[anchor.x, anchor.y, cursor.p.x, cursor.p.y]}
                  stroke="#2563eb"
                  strokeWidth={2}
                  dash={[6, 4]}
                  strokeScaleEnabled={false}
                />
                <Label
                  at={add(anchor, mul(sub(cursor.p, anchor), 0.5))}
                  text={fmtM(dist(anchor, cursor.p))}
                  scale={scale}
                />
              </>
            )}
            {tool === 'room' && roomPts.length > 0 && (
              <Line
                points={[...roomPts, ...(cursor ? [cursor.p] : [])].flatMap((p) => [p.x, p.y])}
                stroke="#7c3aed"
                strokeWidth={2}
                strokeScaleEnabled={false}
              />
            )}
            {tool === 'calibrate' && calPts.length > 0 && (
              <Line
                points={[...calPts, ...(cursor ? [cursor.p] : [])].flatMap((p) => [p.x, p.y])}
                stroke="#dc2626"
                strokeWidth={2}
                strokeScaleEnabled={false}
              />
            )}
            {crosshair && cursor && (
              <Circle x={cursor.p.x} y={cursor.p.y} radius={px(5)} fill={SNAP_COLORS[cursor.kind]} listening={false} />
            )}
          </Layer>
        </Stage>
      )}
      <div className="plan2d-overlay">
        {project.planImage && (
          <label title="Gjennomsiktighet på plantegningen">
            Tegning
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={imgOpacity}
              onChange={(e) => setImgOpacity(+e.target.value)}
            />
          </label>
        )}
        <button
          className={showDims ? 'active' : ''}
          onClick={() => setShowDims(!showDims)}
          title="Vis innvendige vegglengder i hvert rom (det du måler med tommestokk inne i rommet)"
        >
          Mål
        </button>
        <button onClick={() => setManualView(null)} title="Tilpass visning">
          ⤢
        </button>
        {title && <span className="plan-title">{title}</span>}
        {!readOnly && <span className="hint">{HINTS[tool]}</span>}
      </div>
    </div>
  )
}

const HINTS: Record<string, string> = {
  select: 'Klikk for å velge. Dra for å panorere, scroll for å zoome.',
  wall: 'Klikk for å starte/fortsette vegg. Dobbeltklikk/Esc avslutter. Shift = fri vinkel.',
  door: 'Klikk på en vegg for å sette inn en dør.',
  window: 'Klikk på en vegg for å sette inn et vindu.',
  opening: 'Klikk på en vegg for å sette inn en åpning.',
  room: 'Klikk hjørnene i rommet. Klikk på første punkt for å lukke.',
  calibrate: 'Klikk to punkter med kjent avstand (f.eks. en målsatt vegg).',
}

function Grid({ w, h }: { w: number; h: number }) {
  const lines = []
  for (let x = 0; x <= Math.ceil(w); x++)
    lines.push(
      <Line
        key={`x${x}`}
        points={[x, 0, x, h]}
        stroke="#e2e8f0"
        strokeWidth={1}
        strokeScaleEnabled={false}
        listening={false}
      />,
    )
  for (let y = 0; y <= Math.ceil(h); y++)
    lines.push(
      <Line
        key={`y${y}`}
        points={[0, y, w, y]}
        stroke="#e2e8f0"
        strokeWidth={1}
        strokeScaleEnabled={false}
        listening={false}
      />,
    )
  return <>{lines}</>
}

function Label({ at, text, scale, color = '#0f172a' }: { at: Vec2; text: string; scale: number; color?: string }) {
  const width = 160 / scale
  return (
    <Text
      x={at.x - width / 2}
      y={at.y - 16 / scale}
      width={width}
      align="center"
      text={text}
      fontSize={12 / scale}
      fill={color}
      listening={false}
      shadowColor="#fff"
      shadowBlur={4 / scale}
      shadowOpacity={1}
    />
  )
}

/**
 * Length of each edge of a room, measured along the inside face of the walls, drawn just inside
 * the room and parallel to the wall. Comparable with tape-measured lengths.
 */
function RoomEdgeLengths({ room, scale }: { room: Room; scale: number }) {
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

function RoomShape({
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

function OpeningShape(props: {
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

function WallHandles({
  wall,
  walls,
  scale,
  shiftRef,
  updateWall,
}: {
  wall: Wall
  walls: Wall[]
  scale: number
  shiftRef: React.RefObject<boolean>
  updateWall(id: string, patch: Partial<Wall>): void
}) {
  // Walls whose endpoints coincide with the dragged endpoint move along
  const linkedRef = useRef<{ id: string; end: 'a' | 'b' }[]>([])
  const mid = add(wall.a, mul(sub(wall.b, wall.a), 0.5))
  const handle = (end: 'a' | 'b') => (
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
        const p = wall[end]
        linkedRef.current = walls.flatMap((w) =>
          w.id === wall.id
            ? []
            : (['a', 'b'] as const).filter((k) => dist(w[k], p) < 1e-3).map((k) => ({ id: w.id, end: k })),
        )
      }}
      onDragMove={(e) => {
        const other = end === 'a' ? wall.b : wall.a
        const exclude = new Set([wall.id, ...linkedRef.current.map((l) => l.id)])
        const r = snapPoint(
          { x: e.target.x(), y: e.target.y() },
          {
            walls: walls.filter((w) => !exclude.has(w.id)),
            anchor: other,
            tolerance: 12 / scale,
            ortho: !shiftRef.current,
          },
        )
        e.target.position(r.point)
        updateWall(wall.id, { [end]: r.point })
        for (const l of linkedRef.current) updateWall(l.id, { [l.end]: r.point })
      }}
      onDragEnd={endGesture}
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

function SuggestionOverlay({ scale }: { scale: number }) {
  const s = useStore((st) => st.suggestion)!
  const project = useStore((st) => st.project)!
  // Suggestion geometry is in meters at the suggestion's scale; show it aligned with the image
  const k = s.pxPerMeter / project.calibration.pxPerMeter
  const t = (p: Vec2) => ({ x: p.x * k, y: p.y * k })
  const lines = s.walls.map((w) => ({ ...w, a: t(w.a), b: t(w.b), thickness: w.thickness * k }))
  return (
    <Group listening={false}>
      {s.rooms.map((r) => {
        const poly = r.polygon.map(t)
        return (
          <Group key={r.id}>
            <Line
              points={poly.flatMap((p) => [p.x, p.y])}
              closed
              fill="#fb923c"
              opacity={0.12}
              stroke="#ea580c"
              strokeWidth={1}
              dash={[6, 4]}
              strokeScaleEnabled={false}
            />
            <Label at={polygonCentroid(poly)} text={r.name} scale={scale} color="#c2410c" />
          </Group>
        )
      })}
      {lines.map((w) => (
        <Line key={w.id} points={wallQuad(w)} closed fill="#ea580c" opacity={0.7} />
      ))}
      {s.openings.map((o) => {
        const w = lines.find((x) => x.id === o.wallId)
        if (!w) return null
        const d = wallDir(w)
        const c = add(w.a, mul(d, o.offset * k))
        const half = mul(d, (o.width * k) / 2)
        const a = sub(c, half)
        const b = add(c, half)
        return (
          <Line
            key={o.id}
            points={[a.x, a.y, b.x, b.y]}
            stroke={o.kind === 'window' ? '#06b6d4' : '#fde047'}
            strokeWidth={4}
            strokeScaleEnabled={false}
          />
        )
      })}
    </Group>
  )
}

const samePos = (a: Wall, b: Wall) => dist(a.a, b.a) + dist(a.b, b.b) < 0.01

/** Walls removed compared with `other` (red, dashed, where they used to be) and new/moved ones (green). */
function WallDiff({ current, other }: { current: Scenario; other: Scenario }) {
  const removed = other.walls.filter((w) => {
    const now = current.walls.find((x) => x.id === w.id)
    return !now || !samePos(now, w)
  })
  const added = current.walls.filter((w) => {
    const before = other.walls.find((x) => x.id === w.id)
    return !before || !samePos(before, w)
  })
  return (
    <Group listening={false}>
      {removed.map((w) => (
        <Line
          key={`rm-${w.id}`}
          points={wallQuad(w)}
          closed
          fill="#fecaca"
          opacity={0.8}
          stroke="#dc2626"
          strokeWidth={2}
          dash={[6, 4]}
          strokeScaleEnabled={false}
        />
      ))}
      {added.map((w) => (
        <Line
          key={`add-${w.id}`}
          points={wallQuad(w)}
          closed
          stroke="#16a34a"
          strokeWidth={3}
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  )
}
