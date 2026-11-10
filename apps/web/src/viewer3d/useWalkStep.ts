import { useMemo } from 'react'
import { walkBarriers, walkStep, type Vec2 } from '@romslig/shared'
import { useScenario } from '../store.ts'

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
