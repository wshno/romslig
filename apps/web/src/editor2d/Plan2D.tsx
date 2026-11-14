import { useEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Circle, Group, Image as KImage, Layer, Line, Stage } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  add,
  dist,
  footprint,
  furnitureIssues,
  getCatalogItem,
  itemSize,
  mul,
  RUN_INFO,
  sub,
  type Scenario,
} from '@romslig/shared'
import { api } from '../api.ts'
import { activeScenario, useStore } from '../store.ts'
import { Furniture2D } from './Furniture2D.tsx'
import { Installations2D } from './Installations2D.tsx'
import { FURNITURE_DND_TYPE } from '../dnd.ts'
import { fmtM } from '../theme.ts'
import { OpeningShape } from './OpeningShape.tsx'
import { Background, Grid, Label } from './planShapes.tsx'
import { HINTS, SNAP_COLORS, wallFill, wallQuad } from './planStyle.ts'
import { RoomEdgeLengths, RoomLabel, RoomShape } from './RoomShape.tsx'
import { SuggestionOverlay } from './SuggestionOverlay.tsx'
import { useDrawingTool } from './useDrawingTool.ts'
import { WallDiff } from './WallDiff.tsx'
import { WallHandles } from './WallHandles.tsx'

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
  const storeTool = useStore((s) => s.tool)
  const storeSelection = useStore((s) => s.selection)
  const storeSuggestion = useStore((s) => s.suggestion)
  const runKind = useStore((s) => s.runKind)
  const showInstallations = useStore((s) => s.showInstallations)
  const tool = readOnly ? 'select' : storeTool
  const selection = readOnly ? null : storeSelection
  const suggestion = readOnly ? null : storeSuggestion
  const interactive = !readOnly && tool === 'select'
  const { select, updateOpening, setInstallationSettings } = useStore.getState()

  const img = useHtmlImage(
    project.planImage ? `${api.planUrl(project.id)}?v=${project.createdAt}-${project.planImage.file}` : null,
  )
  const ppm = project.calibration.pxPerMeter
  const imgW = project.planImage ? project.planImage.width / ppm : 15
  const imgH = project.planImage ? project.planImage.height / ppm : 10

  /** null = fit the drawing to the container */
  const [ownView, setOwnView] = useState<PlanView | null>(null)
  const manualView = sharedView ? sharedView.value : ownView
  const setManualView = sharedView ? sharedView.set : setOwnView
  const [imgOpacity, setImgOpacity] = useState(0.6)
  const [showDims, setShowDims] = useState(true)
  const issues = useMemo(() => furnitureIssues(scenario), [scenario])
  // Furniture footprints that room labels try not to cover (rugs may be covered)
  const labelObstacles = useMemo(
    () =>
      scenario.furniture.flatMap((f) => {
        const cat = getCatalogItem(f.catalogId)
        return cat.shape === 'rug' ? [] : [footprint(f, itemSize(f, cat))]
      }),
    [scenario.furniture],
  )
  const lastButtonRef = useRef(0)

  const fitView = useMemo(() => {
    if (size.width < 50) return null
    const scale = Math.min(size.width / imgW, size.height / imgH) * 0.92
    return { scale, x: (size.width - imgW * scale) / 2, y: (size.height - imgH * scale) / 2 }
  }, [size, imgW, imgH])
  const view = manualView ?? fitView

  const scale = view?.scale ?? 40
  const px = (n: number) => n / scale // screen pixels → meters
  const walls = scenario.walls

  const { cursor, setCursor, anchor, roomPts, calPts, typedLength, wallEnd, shiftRef, onMouseMove, onClick, endChain } =
    useDrawingTool({
      stageRef,
      tool,
      readOnly,
      walls,
      scale,
      ppm,
      setManualView,
    })

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
            <Background fill="#f8fafc" />
            <Grid />
            {img && <KImage name="bg" image={img} width={imgW} height={imgH} opacity={imgOpacity} />}
          </Layer>
          <Layer>
            {scenario.rooms.map((r) => (
              <RoomShape key={r.id} room={r} selected={selection?.id === r.id} interactive={interactive} />
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
            {showInstallations && (
              <Installations2D scenario={scenario} scale={scale} interactive={interactive} selection={selection} />
            )}
            {/* Labels above furniture and openings, but click-through to what lies under them */}
            <Group listening={false}>
              {scenario.rooms.map((r) => (
                <RoomLabel key={`label-${r.id}`} room={r} scale={scale} obstacles={labelObstacles} />
              ))}
              {showDims && scenario.rooms.map((r) => <RoomEdgeLengths key={`dim-${r.id}`} room={r} scale={scale} />)}
            </Group>
            {selectedWall && <WallHandles wall={selectedWall} scenario={scenario} scale={scale} shiftRef={shiftRef} />}
            {suggestion && <SuggestionOverlay scale={scale} />}

            {/* Tool previews */}
            {tool === 'wall' && anchor && wallEnd && (
              <>
                <Line
                  points={[anchor.x, anchor.y, wallEnd.x, wallEnd.y]}
                  stroke="#2563eb"
                  strokeWidth={2}
                  dash={[6, 4]}
                  strokeScaleEnabled={false}
                />
                <Label
                  at={add(anchor, mul(sub(wallEnd, anchor), 0.5))}
                  text={typedLength !== null ? `${typedLength} m ⏎` : fmtM(dist(anchor, wallEnd))}
                  scale={scale}
                  color={typedLength !== null ? '#2563eb' : undefined}
                />
              </>
            )}
            {(tool === 'room' || tool === 'ceiling' || tool === 'run') && roomPts.length > 0 && (
              <Line
                points={[...roomPts, ...(cursor ? [cursor.p] : [])].flatMap((p) => [p.x, p.y])}
                stroke={tool === 'run' ? RUN_INFO[runKind].color : '#7c3aed'}
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
        <button
          className={showInstallations ? 'active' : ''}
          onClick={() => setInstallationSettings({ showInstallations: !showInstallations })}
          title="Vis stikkontakter, rør, kanaler og nedforet tak"
        >
          Installasjoner
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
