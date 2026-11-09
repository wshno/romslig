import { useMemo } from 'react'
import { describeFurnitureIssue, furnitureIssues, type FurnitureIssue } from '@romslig/shared'
import { useScenario } from './store.ts'

const EMPTY = new Map<string, FurnitureIssue[]>()

/** Furniture problems for the active scenario, recomputed when it changes. */
export function useFurnitureIssues(): Map<string, FurnitureIssue[]> {
  const scenario = useScenario()
  return useMemo(() => (scenario ? furnitureIssues(scenario) : EMPTY), [scenario])
}

/** Human-readable (Norwegian) description of an issue. */
export const describeIssue = describeFurnitureIssue
