import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { walkBarriers, walkStep, type Vec2 } from '@romslig/shared'
import { useScenario } from '../store.ts'
import { EYE_HEIGHT, strideTarget, type WalkInput } from './walkMotion.ts'

/**
 * One stride on foot in the active variant: from where the walker stands toward where the keys
 * point, stopped by walls and let through doors and doorways.
 */
export function useWalkStep(): (from: Vec2, to: Vec2) => Vec2 {
  const scenario = useScenario()
  const walls = scenario?.walls
  const openings = scenario?.openings
  return useMemo(() => {
    const barriers = walkBarriers(walls ?? [], openings ?? [])
    return (from, to) => walkStep(from, to, barriers)
  }, [walls, openings])
}

/**
 * Walking around, whatever steers it (the keyboard or the on-screen stick): puts the camera at eye
 * height at `start` (plan coordinates) when the walk begins, and every frame takes the stride that
 * `input()` asks for along the view, through `useWalkStep`.
 */
export function useWalk(start: Vec2, input: () => WalkInput) {
  const camera = useThree((s) => s.camera)
  const step = useWalkStep()
  // The numbers, not the object: the parent makes a new one on every render, and a walker who is
  // put back at the start whenever something is selected has not walked anywhere
  const { x, y } = start
  useEffect(() => {
    camera.position.set(x, EYE_HEIGHT, y)
  }, [camera, x, y])
  useFrame((_, dt) => {
    const want = input()
    if (!want.forward && !want.right) return
    const look = camera.getWorldDirection(new THREE.Vector3())
    const from = { x: camera.position.x, y: camera.position.z }
    const to = strideTarget(from, { x: look.x, y: look.z }, want, dt)
    // Walls stop the walk, doors and doorways let it through
    const p = step(from, to)
    camera.position.set(p.x, EYE_HEIGHT, p.y)
  })
}
