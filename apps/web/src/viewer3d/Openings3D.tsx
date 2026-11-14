import type { ThreeEvent } from '@react-three/fiber'
import { clampOpening, doorLeaf, norm, sub, wallDir, type Opening, type Wall } from '@romslig/shared'
import { useStore } from '../store.ts'
import { isSelected } from '../selection.ts'

/** Width of a frame member seen from the front (m). */
const FRAME = 0.05
/** Thickness of a door leaf (m). */
const LEAF = 0.04
/** A window at least this wide gets a post in the middle. */
const POST_FROM = 1.2
const HANDLE_HEIGHT = 1.0

const COLORS = { frame: '#ffffff', leaf: '#c8a27a', handle: '#4b5563', glass: '#9fd3f0', selected: '#3b82f6' }

/**
 * A door or a window in its wall: a frame in the hole, and in it either glass or a leaf standing
 * open to the side the door swings to. A doorway without a door is just the hole.
 */
export function Opening3D({ wall, o, cutHeight }: { wall: Wall; o: Opening; cutHeight: number | null }) {
  const selected = useStore((s) => isSelected(s.selection, o.id))
  const pick = useStore((s) => s.pick)
  if (o.kind === 'opening') return null

  const { start, end } = clampOpening(o, wall)
  const d = wallDir(wall)
  const top = Math.min(o.sill + o.height, cutHeight ?? Infinity)
  const h = top - o.sill
  const w = end - start
  if (h < 0.01 || w <= 2 * FRAME) return null
  /** With low walls the top of the frame is cut away, like the wall around it. */
  const whole = top >= o.sill + o.height - 1e-6
  const mid = o.sill + h / 2
  const centre = (start + end) / 2
  // A little proud of the wall on both sides, so the frame does not fight the wall for the same surface
  const depth = wall.thickness + 0.02
  const frame = <meshStandardMaterial color={selected ? COLORS.selected : COLORS.frame} />
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    pick({ kind: 'opening', id: o.id }, e.nativeEvent.shiftKey)
  }

  return (
    <>
      <group position={[wall.a.x, 0, wall.a.y]} rotation-y={-Math.atan2(d.y, d.x)} onClick={onClick}>
        {[start + FRAME / 2, end - FRAME / 2].map((x) => (
          <mesh key={x} position={[x, mid, 0]} castShadow receiveShadow>
            <boxGeometry args={[FRAME, h, depth]} />
            {frame}
          </mesh>
        ))}
        {whole && (
          <mesh position={[centre, top - FRAME / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w - 2 * FRAME, FRAME, depth]} />
            {frame}
          </mesh>
        )}
        {o.kind === 'window' && (
          <>
            <mesh position={[centre, o.sill + FRAME / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[w - 2 * FRAME, FRAME, depth]} />
              {frame}
            </mesh>
            {w >= POST_FROM && (
              <mesh position={[centre, mid, 0]} castShadow receiveShadow>
                <boxGeometry args={[FRAME, h, depth / 2]} />
                {frame}
              </mesh>
            )}
            <mesh position={[centre, mid, 0]}>
              <boxGeometry args={[w - 2 * FRAME, h, 0.02]} />
              <meshStandardMaterial color={COLORS.glass} transparent opacity={0.35} />
            </mesh>
          </>
        )}
      </group>
      {o.kind === 'door' && <DoorLeaf wall={wall} o={o} height={h} selected={selected} onClick={onClick} />}
    </>
  )
}

function DoorLeaf({
  wall,
  o,
  height,
  selected,
  onClick,
}: {
  wall: Wall
  o: Opening
  height: number
  selected: boolean
  onClick(e: ThreeEvent<MouseEvent>): void
}) {
  const leaf = doorLeaf(o, wall)
  if (!leaf) return null
  const out = norm(sub(leaf.tip, leaf.hinge))
  const { start, end } = clampOpening(o, wall)
  const width = end - start - 2 * FRAME
  // The leaf hangs on the inside of the frame, so it is moved in from the edge of the hole
  const inFrame = (o.flip ? -1 : 1) * (FRAME + LEAF / 2)
  return (
    <group position={[leaf.hinge.x, 0, leaf.hinge.y]} rotation-y={-Math.atan2(out.y, out.x)} onClick={onClick}>
      <mesh position={[width / 2, o.sill + height / 2, inFrame]} castShadow receiveShadow>
        <boxGeometry args={[width, height - 0.01, LEAF]} />
        <meshStandardMaterial color={selected ? COLORS.selected : COLORS.leaf} />
      </mesh>
      {o.sill + height > HANDLE_HEIGHT + 0.05 && (
        <mesh position={[width - 0.1, o.sill + HANDLE_HEIGHT, inFrame]}>
          <boxGeometry args={[0.12, 0.025, LEAF + 0.08]} />
          <meshStandardMaterial color={COLORS.handle} />
        </mesh>
      )}
    </group>
  )
}
