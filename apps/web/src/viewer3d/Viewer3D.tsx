import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PointerLockControls } from '@react-three/drei'
import {
  dot,
  sub,
  wallDir,
  wallFootprints,
  wallLength,
  wallPieces,
  type Opening,
  type Room,
  type Vec2,
  type Wall,
} from '@romslig/shared'
import { useScenario, useStore } from '../store.ts'
import { isSelected } from '../selection.ts'
import { useFurnitureIssues } from '../hooks.ts'
import { FURNITURE_DND_TYPE } from '../dnd.ts'
import { useCoarsePointer } from '../device.ts'
import { isAdditive } from '../editor2d/modifiers.ts'
import { distanceToFit } from './fitCamera.ts'
import { floorSurface } from './floorMaterials.ts'
import { Furniture3D } from './Furniture3D.tsx'
import { Installations3D } from './Installations3D.tsx'
import { Opening3D } from './Openings3D.tsx'

/** Converts a screen position to a point on the floor; set by <FloorPicker> inside the canvas. */
type FloorPick = (clientX: number, clientY: number) => { x: number; y: number } | null
import { ROOM_COLORS } from '../theme.ts'
import { useWalk } from './useWalkStep.ts'
import { TouchWalk } from './TouchWalk.tsx'
import { WalkStick } from './WalkStick.tsx'
import { STANDING, clickSlop, keyInput, type WalkInput } from './walkMotion.ts'

type CameraMode = 'orbit' | 'walk'

export function Viewer3D() {
  const scenario = useScenario()
  const [mode, setMode] = useState<CameraMode>('orbit')
  const [cutHeight, setCutHeight] = useState<number | null>(null)
  const [showLoadBearing, setShowLoadBearing] = useState(true)
  const [roomColors, setRoomColors] = useState(false)
  const issues = useFurnitureIssues()
  const selection = useStore((s) => s.selection)
  const dragging3d = useStore((s) => s.dragging3d)
  const showInstallations = useStore((s) => s.showInstallations)
  const ceilingHeight = useStore((s) => s.project?.ceilingHeight ?? 2.4)
  const pickRef = useRef<FloorPick | null>(null)
  /** Where the pointer went down, and with what, to tell a click from the end of a drag. */
  const pressRef = useRef({ x: 0, y: 0, pointerType: 'mouse' })
  /** A finger instead of a mouse: the walk is steered on screen, and the GPU is spared. */
  const coarse = useCoarsePointer()
  /** What the on-screen stick asks for; read by <TouchWalk> every frame. */
  const stickRef = useRef<WalkInput>(STANDING)
  const viewerRef = useRef<HTMLDivElement>(null)

  const bounds = useMemo(() => {
    const pts = scenario?.walls.flatMap((w) => [w.a, w.b]) ?? []
    if (!pts.length) return { cx: 5, cy: 4, size: 12 }
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: Math.max(maxX - minX, maxY - minY, 4) }
  }, [scenario?.walls])
  const footprints = useMemo(() => wallFootprints(scenario?.walls ?? []), [scenario?.walls])

  if (!scenario) return null
  // On a touch screen the walk is steered on screen; with a mouse, pointer lock and the keys
  const start = { x: bounds.cx, y: bounds.cy }
  const walk = coarse ? (
    <TouchWalk start={start} stickRef={stickRef} />
  ) : (
    <Walk start={start} onExit={() => setMode('orbit')} />
  )
  return (
    <div
      className="viewer3d"
      ref={viewerRef}
      onPointerDownCapture={(e) => {
        pressRef.current = { x: e.clientX, y: e.clientY, pointerType: e.pointerType }
      }}
      onClickCapture={(e) => {
        // Turning the view or moving a piece of furniture also ends in a click. It is not a selection:
        // keep it from the 3D scene, where it would select whatever is under the pointer.
        const moved = Math.hypot(e.clientX - pressRef.current.x, e.clientY - pressRef.current.y)
        const slop = clickSlop(pressRef.current.pointerType)
        if (moved > slop && e.target instanceof HTMLCanvasElement) e.stopPropagation()
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(FURNITURE_DND_TYPE)) e.preventDefault()
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(FURNITURE_DND_TYPE)
        const p = id ? pickRef.current?.(e.clientX, e.clientY) : null
        if (!id || !p) return
        e.preventDefault()
        useStore.getState().addFurniture(id, p, { snap: !e.shiftKey })
        useStore.getState().setTool('select')
      }}
    >
      <Canvas
        shadows
        // R3F's default today, said out loud: a phone with a 3x screen draws at 2x, which is plenty
        dpr={[1, 2]}
        // A click that hits nothing selectable (the ground, the sky) lets go of the selection, as in 2D
        // (with Shift or «Velg flere», which add to the selection, it is kept)
        onPointerMissed={(e) => {
          if (!isAdditive(e)) useStore.getState().select(null)
        }}
        camera={{
          fov: 50,
          near: 0.05,
          far: 500,
          position: [bounds.cx + bounds.size * 0.6, bounds.size * 0.9, bounds.cy + bounds.size * 0.9],
        }}
      >
        <color attach="background" args={['#e8edf3']} />
        <hemisphereLight args={['#ffffff', '#cfc6b8', 1.5]} />
        <directionalLight
          // A new light when the size changes: three.js does not rebuild a shadow map it has made
          key={coarse ? 'coarse' : 'fine'}
          position={[bounds.cx + 8, 14, bounds.cy + 5]}
          intensity={1.6}
          castShadow
          // A phone or tablet GPU pays for every shadow texel; at 1024 the shadows are only a bit softer
          shadow-mapSize={coarse ? [1024, 1024] : [2048, 2048]}
          shadow-camera-left={-bounds.size}
          shadow-camera-right={bounds.size}
          shadow-camera-top={bounds.size}
          shadow-camera-bottom={-bounds.size}
        />
        <mesh rotation-x={-Math.PI / 2} position={[bounds.cx, -0.01, bounds.cy]} receiveShadow>
          <planeGeometry args={[bounds.size * 4, bounds.size * 4]} />
          <meshStandardMaterial color="#d7dde5" />
        </mesh>
        {scenario.rooms.map((r) => (
          <Floor key={r.id} room={r} byType={roomColors} />
        ))}
        <FloorPicker pickRef={pickRef} />
        {showInstallations && <Installations3D scenario={scenario} ceilingHeight={ceilingHeight} />}
        {scenario.furniture.map((f) => (
          <Furniture3D key={f.id} item={f} hasIssues={issues.has(f.id)} selected={isSelected(selection, f.id)} />
        ))}
        {scenario.walls.map((w) => (
          <WallMesh
            key={w.id}
            wall={w}
            footprint={footprints.get(w.id)!}
            openings={scenario.openings}
            cutHeight={cutHeight}
            showLoadBearing={showLoadBearing}
          />
        ))}
        {scenario.openings.map((o) => {
          const w = scenario.walls.find((x) => x.id === o.wallId)
          return w ? <Opening3D key={o.id} wall={w} o={o} cutHeight={cutHeight} /> : null
        })}
        {mode === 'orbit' ? (
          <>
            <OrbitControls
              makeDefault
              enabled={!dragging3d}
              target={[bounds.cx, 0, bounds.cy]}
              maxPolarAngle={Math.PI / 2 - 0.02}
            />
            <FitCamera bounds={bounds} />
          </>
        ) : (
          walk
        )}
        <CameraProbe viewerRef={viewerRef} />
      </Canvas>
      <div className="viewer3d-overlay">
        <button className={mode === 'orbit' ? 'active' : ''} onClick={() => setMode('orbit')}>
          Fugleperspektiv
        </button>
        <button
          className={mode === 'walk' ? 'active' : ''}
          onClick={() => setMode('walk')}
          title={
            coarse
              ? 'Spaken nede til venstre for å gå, dra i bildet for å se deg rundt'
              : 'WASD for å gå, mus for å se. Esc avslutter.'
          }
        >
          Gå rundt
        </button>
        <button
          className={cutHeight ? 'active' : ''}
          onClick={() => setCutHeight(cutHeight ? null : 1.1)}
          title="Kutt veggene i 1,1 m høyde"
        >
          Lave vegger
        </button>
        <button
          className={roomColors ? 'active' : ''}
          onClick={() => setRoomColors(!roomColors)}
          title="Fargelegg gulvene etter romtype, som i 2D"
        >
          Romfarger
        </button>
        <button
          className={showLoadBearing ? 'active' : ''}
          onClick={() => setShowLoadBearing(!showLoadBearing)}
          title="Marker vegger merket som bærende"
        >
          Bærevegger
        </button>
        <button
          className={showInstallations ? 'active' : ''}
          onClick={() => useStore.getState().setInstallationSettings({ showInstallations: !showInstallations })}
          title="Vis stikkontakter, rør, kanaler og nedforet tak"
        >
          Installasjoner
        </button>
      </div>
      {mode === 'walk' && coarse && <WalkStick stickRef={stickRef} />}
      {mode === 'walk' &&
        (coarse ? (
          <div className="walk-hint touch">Spaken = gå, dra i bildet = se deg rundt. Fugleperspektiv avslutter</div>
        ) : (
          <div className="walk-hint">Klikk i 3D-vinduet for å styre. WASD = gå, mus = se, Esc = avslutt</div>
        ))}
    </div>
  )
}

function Floor({ room, byType }: { room: Room; byType: boolean }) {
  const geom = useMemo(() => {
    if (room.polygon.length < 3) return null
    // Shape lives in XY; rotating -90° around X maps (x, -y) → (x, 0, y)
    const shape = new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, -p.y)))
    return new THREE.ShapeGeometry(shape)
  }, [room.polygon])
  const surface = useMemo(() => floorSurface(room), [room])
  const selected = useStore((s) => isSelected(s.selection, room.id))
  const pick = useStore((s) => s.pick)
  if (!geom) return null
  return (
    <mesh
      geometry={geom}
      rotation-x={-Math.PI / 2}
      position-y={0.001}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation()
        pick({ kind: 'room', id: room.id }, e.nativeEvent.shiftKey)
      }}
    >
      {byType || selected ? (
        // A tint on top of the boards turns muddy, so the selected floor is plain
        <meshStandardMaterial
          key="plain"
          color={selected ? '#93c5fd' : ROOM_COLORS[room.type]}
          side={THREE.DoubleSide}
        />
      ) : (
        <meshStandardMaterial key="surface" map={surface.map} roughness={surface.roughness} side={THREE.DoubleSide} />
      )}
    </mesh>
  )
}

function wallColor(wall: Wall, selected: boolean, showLoadBearing: boolean): string {
  if (selected) return '#3b82f6'
  if (showLoadBearing && wall.loadBearing === 'yes') return '#c08b80'
  return wall.exterior ? '#e7e2da' : '#f5f3ef'
}

/** The part of a polygon where (x - at) * side >= 0. */
function clipAlong(poly: Vec2[], at: number, side: 1 | -1): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    const fp = (p.x - at) * side
    const fq = (q.x - at) * side
    if (fp >= 0) out.push(p)
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq)
      out.push({ x: at, y: p.y + (q.y - p.y) * t })
    }
  }
  // A corner right on the line comes out twice; repeated points upset the triangulation
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length]!
    return Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > 1e-9
  })
}

/**
 * A wall is built from its pieces beside, under and over the openings (see `wallPieces`). Each
 * piece is the wall's plan footprint cut square to the piece's stretch along the wall and extruded
 * over the piece's height, so the ends of the wall are mitred or flush like in 2D while the
 * openings stay square holes.
 */
function WallMesh({
  wall,
  footprint,
  openings,
  cutHeight,
  showLoadBearing,
}: {
  wall: Wall
  /** The wall's outline in plan, from `wallFootprint`. */
  footprint: Vec2[]
  openings: Opening[]
  cutHeight: number | null
  showLoadBearing: boolean
}) {
  const selected = useStore((s) => isSelected(s.selection, wall.id))
  const pick = useStore((s) => s.pick)
  const color = wallColor(wall, selected, showLoadBearing)
  const d = wallDir(wall)
  const angle = -Math.atan2(d.y, d.x)
  const pieces = useMemo(() => {
    const L = wallLength(wall)
    const along = wallDir(wall)
    // In the group's frame x runs along the wall from wall.a and z along the wall's left normal
    const across = { x: -along.y, y: along.x }
    const local = footprint.map((p) => ({ x: dot(sub(p, wall.a), along), y: dot(sub(p, wall.a), across) }))
    return wallPieces(wall, openings)
      .map((p) => (cutHeight ? { ...p, z1: Math.min(p.z1, cutHeight) } : p))
      .filter((p) => p.z1 - p.z0 > 1e-3)
      .flatMap((p) => {
        // Cut only at openings; at the wall's own ends the footprint decides where it stops
        let poly = local
        if (p.s0 > 1e-6) poly = clipAlong(poly, p.s0, 1)
        if (p.s1 < L - 1e-6) poly = clipAlong(poly, p.s1, -1)
        if (poly.length < 3) return []
        // Shape lives in XY and is extruded along +Z; rotating -90° around X maps (x, y, z) to (x, z, -y)
        const shape = new THREE.Shape(poly.map((q) => new THREE.Vector2(q.x, -q.y)))
        return [{ key: `${p.s0}:${p.z0}`, z0: p.z0, height: p.z1 - p.z0, shape }]
      })
  }, [wall, footprint, openings, cutHeight])
  return (
    <group
      position={[wall.a.x, 0, wall.a.y]}
      rotation-y={angle}
      onClick={(e) => {
        e.stopPropagation()
        pick({ kind: 'wall', id: wall.id }, e.nativeEvent.shiftKey)
      }}
    >
      {pieces.map((p) => (
        <mesh key={p.key} position={[0, p.z0, 0]} rotation-x={-Math.PI / 2} castShadow receiveShadow>
          <extrudeGeometry args={[p.shape, { depth: p.height, bevelEnabled: false }]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  )
}

function Walk({ start, onExit }: { start: Vec2; onExit(): void }) {
  const keysRef = useRef<Record<string, boolean>>({})
  useWalk(start, () => keyInput(keysRef.current))
  useEffect(() => {
    const down = (e: KeyboardEvent) => (keysRef.current[e.code] = true)
    const up = (e: KeyboardEvent) => (keysRef.current[e.code] = false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
  return <PointerLockControls makeDefault onUnlock={onExit} />
}

/**
 * Writes where the camera is onto the viewer as `data-camera="x,y,z"` (m, two decimals), a few times
 * a second and only when it changed. The canvas cannot be looked into from outside, and this is how
 * the end-to-end tests see that walking moved the camera. It costs one string per quarter second and
 * is the same in production, so the tests run the code that ships.
 */
function CameraProbe({ viewerRef }: { viewerRef: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera)
  const sinceRef = useRef(Infinity)
  useFrame((_, dt) => {
    sinceRef.current += dt
    const el = viewerRef.current
    if (sinceRef.current < 0.25 || !el) return
    sinceRef.current = 0
    const p = camera.position
    const v = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`
    if (el.dataset.camera !== v) el.dataset.camera = v
  })
  return null
}

/** Air around the model when the camera frames it. */
const FIT_MARGIN = 1.12

/** Where the camera looks from, relative to the middle of the plan. */
const VIEW_DIRECTION = new THREE.Vector3(0.6, 0.9, 0.9)

/**
 * Frames the whole model when the 3D view opens and when the model's extent changes noticeably (e.g. after
 * digitizing). A change in the shape of the view frames it again as long as the camera is where it was put.
 */
function FitCamera({ bounds }: { bounds: { cx: number; cy: number; size: number } }) {
  const camera = useThree((s) => s.camera)
  const aspect = useThree((s) => s.size.width / s.size.height)
  const walls = useScenario()?.walls
  const lastRef = useRef<{ bounds: typeof bounds; aspect: number; position: THREE.Vector3 } | null>(null)
  useEffect(() => {
    const l = lastRef.current
    const moved =
      !l ||
      Math.abs(l.bounds.size - bounds.size) > 1 ||
      Math.hypot(l.bounds.cx - bounds.cx, l.bounds.cy - bounds.cy) > 1
    const reshaped = l && Math.abs(l.aspect - aspect) > 0.01 && camera.position.distanceTo(l.position) < 1e-3
    if (!moved && !reshaped) return
    const target = new THREE.Vector3(bounds.cx, 0, bounds.cy)
    const box = new THREE.Box3()
    for (const w of walls ?? []) {
      box.expandByPoint(new THREE.Vector3(w.a.x, 0, w.a.y))
      box.expandByPoint(new THREE.Vector3(w.b.x, w.height, w.b.y))
    }
    // Nothing drawn yet: frame the area the ground and the lights are set up for
    if (box.isEmpty()) box.setFromCenterAndSize(target, new THREE.Vector3(bounds.size, 0, bounds.size))
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50
    const distance = distanceToFit(box, target, VIEW_DIRECTION, fov, aspect) * FIT_MARGIN
    camera.position.copy(target).addScaledVector(VIEW_DIRECTION.clone().normalize(), distance)
    camera.lookAt(target)
    lastRef.current = { bounds, aspect, position: camera.position.clone() }
  }, [bounds, aspect, walls, camera])
  return null
}

function FloorPicker({ pickRef }: { pickRef: React.RefObject<FloorPick | null> }) {
  const { camera, gl } = useThree()
  useEffect(() => {
    const raycaster = new THREE.Raycaster()
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hit = new THREE.Vector3()
    pickRef.current = (clientX, clientY) => {
      const r = gl.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray.intersectPlane(floor, hit) ? { x: hit.x, y: hit.z } : null
    }
    return () => {
      pickRef.current = null
    }
  }, [camera, gl, pickRef])
  return null
}
