import { useMemo } from 'react'
import * as THREE from 'three'
import {
  FIXTURE_INFO,
  RUN_INFO,
  closestPointOnSegment,
  type Fixture,
  type LoweredCeiling,
  type Run,
  type Scenario,
} from '@romslig/shared'
import { useStore } from '../store.ts'

const CATEGORY_COLORS = { electric: '#eab308', water: '#2563eb', ventilation: '#16a34a' } as const
const UP = new THREE.Vector3(0, 1, 0)

/** Installations in 3D: fixtures on the walls, runs as pipes/ducts, lowered ceilings as boxes. */
export function Installations3D({ scenario, ceilingHeight }: { scenario: Scenario; ceilingHeight: number }) {
  return (
    <group>
      {scenario.fixtures.map((f) => (
        <Fixture3D key={f.id} fx={f} scenario={scenario} />
      ))}
      {scenario.runs.map((r) => (
        <Run3D key={r.id} run={r} />
      ))}
      {scenario.loweredCeilings.map((c) => (
        <Ceiling3D key={c.id} ceiling={c} ceilingHeight={ceilingHeight} />
      ))}
    </group>
  )
}

function useSelect(kind: 'fixture' | 'run' | 'ceiling', id: string) {
  const selected = useStore((s) => s.selection?.id === id)
  const onClick = (e: { stopPropagation(): void }) => {
    if (useStore.getState().tool !== 'select') return
    e.stopPropagation()
    useStore.getState().select({ kind, id })
  }
  return { selected, onClick }
}

function Fixture3D({ fx, scenario }: { fx: Fixture; scenario: Scenario }) {
  const { selected, onClick } = useSelect('fixture', fx.id)
  const info = FIXTURE_INFO[fx.kind]
  const color = selected ? '#3b82f6' : CATEGORY_COLORS[info.category]
  // Face away from the wall the fixture is mounted on
  const angle = useMemo(() => {
    const w = scenario.walls.find((x) => x.id === fx.wallId)
    if (!w) return 0
    const c = closestPointOnSegment(fx, w.a, w.b).point
    return Math.atan2(fx.x - c.x, fx.y - c.y)
  }, [fx, scenario.walls])
  const pos: [number, number, number] = [fx.x, fx.z, fx.y]

  switch (fx.kind) {
    case 'ceiling_light':
      return (
        <mesh position={[fx.x, fx.z - 0.03, fx.y]} onClick={onClick}>
          <cylinderGeometry args={[0.07, 0.07, 0.05, 16]} />
          <meshStandardMaterial color={color} emissive="#fde68a" emissiveIntensity={0.6} />
        </mesh>
      )
    case 'drain':
      return (
        <mesh position={[fx.x, 0.005, fx.y]} onClick={onClick}>
          <cylinderGeometry args={[0.08, 0.08, 0.01, 20]} />
          <meshStandardMaterial color={selected ? '#3b82f6' : '#94a3b8'} />
        </mesh>
      )
    case 'fuse_box':
      return (
        <mesh position={pos} rotation-y={angle} onClick={onClick}>
          <boxGeometry args={[0.45, 0.55, 0.12]} />
          <meshStandardMaterial color={selected ? '#3b82f6' : '#f1f5f9'} emissive={color} emissiveIntensity={0.15} />
        </mesh>
      )
    case 'main_valve':
    case 'water_inlet':
      return (
        <group position={pos} rotation-y={angle} onClick={onClick}>
          <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.04]}>
            <cylinderGeometry args={[0.025, 0.025, 0.08, 12]} />
            <meshStandardMaterial color={selected ? '#3b82f6' : '#2563eb'} />
          </mesh>
          {fx.kind === 'main_valve' && (
            <mesh position={[0, 0, 0.09]}>
              <torusGeometry args={[0.04, 0.01, 8, 20]} />
              <meshStandardMaterial color={selected ? '#3b82f6' : '#dc2626'} />
            </mesh>
          )}
        </group>
      )
    default:
      return (
        <mesh position={pos} rotation-y={angle} onClick={onClick}>
          <boxGeometry args={[fx.kind === 'outlet_double' ? 0.15 : 0.08, 0.08, 0.02]} />
          <meshStandardMaterial color={selected ? '#3b82f6' : '#f8fafc'} emissive={color} emissiveIntensity={0.35} />
        </mesh>
      )
  }
}

function Run3D({ run }: { run: Run }) {
  const { selected, onClick } = useSelect('run', run.id)
  const info = RUN_INFO[run.kind]
  const radius = Math.max(run.diameter / 2, 0.012)
  const segments = useMemo(
    () =>
      run.points.slice(1).map((p, i) => {
        const a = new THREE.Vector3(run.points[i]!.x, run.z, run.points[i]!.y)
        const b = new THREE.Vector3(p.x, run.z, p.y)
        const dir = new THREE.Vector3().subVectors(b, a)
        const length = dir.length()
        const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
        const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())
        return { key: `${run.id}-s${i}`, mid, q, length }
      }),
    [run],
  )
  return (
    <group onClick={onClick}>
      {segments.map((s) => (
        <mesh key={s.key} position={s.mid} quaternion={s.q}>
          <cylinderGeometry args={[radius, radius, s.length + radius, 12]} />
          <meshStandardMaterial color={selected ? '#3b82f6' : info.color} />
        </mesh>
      ))}
    </group>
  )
}

function Ceiling3D({ ceiling, ceilingHeight }: { ceiling: LoweredCeiling; ceilingHeight: number }) {
  const { selected, onClick } = useSelect('ceiling', ceiling.id)
  const depth = Math.max(0.01, ceilingHeight - ceiling.height)
  const geom = useMemo(() => {
    const shape = new THREE.Shape(ceiling.polygon.map((p) => new THREE.Vector2(p.x, -p.y)))
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  }, [ceiling.polygon, depth])
  // Extrude along +z in shape space; rotate so it grows upwards from the underside
  return (
    <mesh geometry={geom} rotation-x={-Math.PI / 2} position-y={ceiling.height} onClick={onClick}>
      <meshStandardMaterial
        color={selected ? '#3b82f6' : '#a78bfa'}
        transparent
        opacity={0.35}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}
