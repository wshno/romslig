import { useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { getCatalogItem, itemSize, type CatalogItem, type FurnitureItem, type Size } from '@romslig/shared'
import { beginGesture, endGesture, useStore } from '../store.ts'

const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

interface Props {
  item: FurnitureItem
  hasIssues: boolean
  selected: boolean
}

/**
 * A furniture item in 3D. Local frame: width along x, depth along z, front faces +z, y up from
 * the floor (or from the item's elevation). Drag it across the floor in select mode.
 */
export function Furniture3D({ item, hasIssues, selected }: Props) {
  const cat = getCatalogItem(item.catalogId)
  const size = itemSize(item, cat)
  const dragRef = useRef<{ dx: number; dz: number } | null>(null)
  const hit = new THREE.Vector3()

  const tint = (() => {
    if (hasIssues) return '#ef4444'
    if (selected) return '#3b82f6'
    return null
  })()

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (useStore.getState().tool !== 'select') return
    // Behind a wall or under a floor seen from this side: the click selects that, so leave the press to it too
    if (e.intersections[0]?.eventObject !== e.eventObject) return
    e.stopPropagation()
    // Shift+click toggles it in the selection and moves nothing; a plain press selects it alone and
    // drags it (in 3D one item moves at a time)
    if (e.nativeEvent.shiftKey) return useStore.getState().pick({ kind: 'furniture', id: item.id }, true)
    useStore.getState().select({ kind: 'furniture', id: item.id })
    if (!e.ray.intersectPlane(FLOOR, hit)) return
    dragRef.current = { dx: item.x - hit.x, dz: item.y - hit.z }
    ;(e.target as Element).setPointerCapture(e.pointerId)
    beginGesture()
    useStore.setState({ dragging3d: true })
  }
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    if (!drag || !e.ray.intersectPlane(FLOOR, hit)) return
    e.stopPropagation()
    useStore.getState().moveFurniture(item.id, { x: hit.x + drag.dx, y: hit.z + drag.dz }, !e.shiftKey)
  }
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return
    dragRef.current = null
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    endGesture()
    useStore.setState({ dragging3d: false })
  }

  return (
    <group
      position={[item.x, cat.elevation ?? 0, item.y]}
      rotation-y={(-item.rotation * Math.PI) / 180}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // The press selected this piece: keep the click from going on to the floor or wall behind it
      onClick={(e) => {
        if (useStore.getState().tool === 'select') e.stopPropagation()
      }}
    >
      <Shape cat={cat} size={size} tint={tint} />
    </group>
  )
}

function Mat({ color, tint, opacity }: { color: string; tint: string | null; opacity?: number }) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={tint ?? '#000000'}
      emissiveIntensity={tint ? 0.35 : 0}
      transparent={opacity !== undefined}
      opacity={opacity ?? 1}
      roughness={0.8}
    />
  )
}

/** A box given by its min corner (x0,y0,z0) and size, in the item's local frame. */
function B({
  x,
  y,
  z,
  w,
  h,
  d,
  color,
  tint,
  opacity,
}: {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  color: string
  tint: string | null
  opacity?: number
}) {
  if (w <= 0 || h <= 0 || d <= 0) return null
  return (
    <mesh position={[x + w / 2, y + h / 2, z + d / 2]} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <Mat color={color} tint={tint} opacity={opacity} />
    </mesh>
  )
}

const darker = (hex: string, k = 0.75) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString()

function Shape({ cat, size, tint }: { cat: CatalogItem; size: Size; tint: string | null }) {
  const { w, d, h } = size
  const x0 = -w / 2
  const z0 = -d / 2
  const c = cat.color
  const t = tint
  switch (cat.shape) {
    case 'sofa':
    case 'armchair': {
      const arm = Math.min(0.2, w * 0.15)
      const backD = Math.min(0.22, d * 0.3)
      return (
        <>
          <B x={x0} y={0} z={z0} w={w} h={0.42} d={d} color={c} tint={t} />
          <B x={x0} y={0.42} z={z0} w={w} h={h - 0.42} d={backD} color={darker(c, 0.9)} tint={t} />
          <B x={x0} y={0.42} z={z0} w={arm} h={0.2} d={d} color={darker(c, 0.9)} tint={t} />
          <B x={-x0 - arm} y={0.42} z={z0} w={arm} h={0.2} d={d} color={darker(c, 0.9)} tint={t} />
        </>
      )
    }
    case 'bed': {
      const head = 0.08
      return (
        <>
          <B x={x0} y={0} z={z0} w={w} h={0.32} d={d} color={'#8b6b4a'} tint={t} />
          <B x={x0 + 0.03} y={0.32} z={z0 + head} w={w - 0.06} h={0.2} d={d - head - 0.03} color={c} tint={t} />
          <B x={x0} y={0} z={z0} w={w} h={h} d={head} color={'#8b6b4a'} tint={t} />
          <B x={x0 + 0.1} y={0.52} z={z0 + head + 0.05} w={w / 2 - 0.15} h={0.12} d={0.4} color="#ffffff" tint={t} />
          <B x={0.05} y={0.52} z={z0 + head + 0.05} w={w / 2 - 0.15} h={0.12} d={0.4} color="#ffffff" tint={t} />
          <B
            x={x0 + 0.03}
            y={0.53}
            z={z0 + head + 0.55}
            w={w - 0.06}
            h={0.04}
            d={d - head - 0.6}
            color="#9fb3c8"
            tint={t}
          />
        </>
      )
    }
    case 'table': {
      const round = cat.id.includes('rundt')
      const leg = 0.05
      const legs: [number, number][] = [
        [x0 + 0.06, z0 + 0.06],
        [-x0 - 0.06 - leg, z0 + 0.06],
        [x0 + 0.06, -z0 - 0.06 - leg],
        [-x0 - 0.06 - leg, -z0 - 0.06 - leg],
      ]
      return (
        <>
          {round ? (
            <mesh position={[0, h - 0.02, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[w / 2, w / 2, 0.04, 40]} />
              <Mat color={c} tint={t} />
            </mesh>
          ) : (
            <B x={x0} y={h - 0.04} z={z0} w={w} h={0.04} d={d} color={c} tint={t} />
          )}
          {round ? (
            <B x={-0.04} y={0} z={-0.04} w={0.08} h={h - 0.04} d={0.08} color={darker(c)} tint={t} />
          ) : (
            legs.map(([lx, lz]) => (
              <B key={`${lx}:${lz}`} x={lx} y={0} z={lz} w={leg} h={h - 0.04} d={leg} color={darker(c)} tint={t} />
            ))
          )}
        </>
      )
    }
    case 'chair': {
      const seat = 0.45
      return (
        <>
          <B x={x0} y={seat - 0.05} z={z0} w={w} h={0.05} d={d} color={c} tint={t} />
          <B x={x0} y={seat} z={z0} w={w} h={h - seat} d={0.04} color={c} tint={t} />
          {[x0 + 0.02, -x0 - 0.05].flatMap((lx) =>
            [z0 + 0.02, -z0 - 0.05].map((lz) => (
              <B key={`${lx}:${lz}`} x={lx} y={0} z={lz} w={0.03} h={seat - 0.05} d={0.03} color={darker(c)} tint={t} />
            )),
          )}
        </>
      )
    }
    case 'wardrobe':
      return (
        <>
          <B x={x0} y={0} z={z0} w={w} h={h} d={d} color={c} tint={t} />
          {Array.from({ length: Math.max(1, Math.round(w / 0.5)) - 1 }, (_, i) => (
            <B
              key={`door-${(i + 1) / Math.round(w / 0.5)}`}
              x={x0 + ((i + 1) * w) / Math.round(w / 0.5) - 0.004}
              y={0.02}
              z={-z0}
              w={0.008}
              h={h - 0.04}
              d={0.005}
              color="#9ca3af"
              tint={t}
            />
          ))}
        </>
      )
    case 'counter':
      return (
        <>
          <B x={x0} y={0.1} z={z0} w={w} h={h - 0.14} d={d - 0.02} color={c} tint={t} />
          <B x={x0 + 0.02} y={0} z={z0} w={w - 0.04} h={0.1} d={d - 0.08} color="#3f3f46" tint={t} />
          <B x={x0} y={h - 0.04} z={z0} w={w} h={0.04} d={d} color="#5b5b60" tint={t} />
          {cat.id === 'komfyr' && (
            <B x={x0 + 0.05} y={h} z={z0 + 0.05} w={w - 0.1} h={0.005} d={d - 0.1} color="#111111" tint={t} />
          )}
        </>
      )
    case 'wc':
      return (
        <>
          <B x={x0} y={0} z={z0} w={w} h={h} d={0.18} color={c} tint={t} />
          <mesh position={[0, 0.2, z0 + 0.18 + (d - 0.18) / 2]} castShadow>
            <cylinderGeometry args={[w / 2, w / 2.6, 0.4, 24]} />
            <Mat color={c} tint={t} />
          </mesh>
        </>
      )
    case 'sink':
      return (
        <>
          <B x={x0} y={0.15} z={z0} w={w} h={h - 0.3} d={d} color="#d6d3d1" tint={t} />
          <B x={x0} y={h - 0.15} z={z0} w={w} h={0.15} d={d} color={c} tint={t} />
        </>
      )
    case 'shower':
      return (
        <>
          <B x={x0} y={0} z={z0} w={w} h={0.05} d={d} color="#f5f5f4" tint={t} />
          <B x={x0} y={0.05} z={z0} w={w} h={h - 0.05} d={d} color={c} tint={t} opacity={0.3} />
        </>
      )
    case 'bathtub':
      return (
        <>
          <B x={x0} y={0} z={z0} w={w} h={h} d={d} color={c} tint={t} />
          <B x={x0 + 0.08} y={h - 0.005} z={z0 + 0.08} w={w - 0.16} h={0.01} d={d - 0.16} color="#bfdbfe" tint={t} />
        </>
      )
    case 'rug':
      return <B x={x0} y={0} z={z0} w={w} h={Math.max(0.01, h)} d={d} color={c} tint={t} />
    case 'plant':
      return (
        <>
          <mesh position={[0, 0.18, 0]} castShadow>
            <cylinderGeometry args={[Math.min(w, d) * 0.35, Math.min(w, d) * 0.28, 0.36, 20]} />
            <Mat color="#a16207" tint={t} />
          </mesh>
          <mesh position={[0, 0.36 + (h - 0.36) / 2, 0]} castShadow>
            <sphereGeometry args={[Math.min(w, d) / 2, 16, 12]} />
            <Mat color={c} tint={t} />
          </mesh>
        </>
      )
    default:
      return <B x={x0} y={0} z={z0} w={w} h={h} d={d} color={c} tint={t} />
  }
}
