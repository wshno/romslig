import { useEffect, type RefObject } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { Vec2 } from '@romslig/shared'
import { useStore } from '../store.ts'
import { useWalk } from './useWalkStep.ts'
import { turnView, type WalkInput } from './walkMotion.ts'

/**
 * "Gå rundt" with a finger. Pointer lock and WASD have nothing to hold on to on a touch screen, so
 * the walk is steered by the on-screen stick (`WalkStick.tsx`, outside the canvas, writing into
 * `stickRef`), and a finger dragged anywhere on the view turns it. Lives inside the <Canvas>.
 */
export function TouchWalk({ start, stickRef }: { start: Vec2; stickRef: RefObject<WalkInput> }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  // The element R3F listens on (the canvas's wrapper), so a press that grabs a piece of furniture has
  // already been handled by the scene when it gets here
  const connected = useThree((s) => s.events.connected as HTMLElement | null | undefined)
  useWalk(start, () => stickRef.current)

  // From the bird's-eye view the camera looks steeply down; a walker looks ahead, the same way
  useEffect(() => {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    camera.quaternion.setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'))
  }, [camera])

  useEffect(() => {
    const el = connected ?? gl.domElement
    let finger: { id: number; x: number; y: number } | null = null
    const euler = new THREE.Euler(0, 0, 0, 'YXZ')
    const down = (e: PointerEvent) => {
      // One finger turns the view; a second one, or a press that started dragging furniture, does not
      if (finger || useStore.getState().dragging3d) return
      finger = { id: e.pointerId, x: e.clientX, y: e.clientY }
      // A touch is held by the canvas anyway; this keeps a mouse turning outside the view too
      el.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== finger?.id || useStore.getState().dragging3d) return
      const dx = e.clientX - finger.x
      const dy = e.clientY - finger.y
      finger = { ...finger, x: e.clientX, y: e.clientY }
      euler.setFromQuaternion(camera.quaternion)
      const v = turnView({ yaw: euler.y, pitch: euler.x }, dx, dy)
      euler.set(v.pitch, v.yaw, 0)
      camera.quaternion.setFromEuler(euler)
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== finger?.id) return
      finger = null
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [camera, gl, connected])
  return null
}
