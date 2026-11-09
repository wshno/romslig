import { useMemo } from 'react'
import { furnitureIssues, getCatalogItem, type FurnitureIssue, type Scenario } from '@romslig/shared'
import { useScenario } from './store.ts'

const EMPTY = new Map<string, FurnitureIssue[]>()

/** Furniture problems for the active scenario, recomputed when it changes. */
export function useFurnitureIssues(): Map<string, FurnitureIssue[]> {
  const scenario = useScenario()
  return useMemo(() => (scenario ? furnitureIssues(scenario) : EMPTY), [scenario])
}

const SIDE_LABELS = { front: 'foran', back: 'bak', left: 'til venstre', right: 'til høyre' } as const

/** Human-readable (Norwegian) description of an issue. */
export function describeIssue(issue: FurnitureIssue, scenario: Scenario, itemCatalogId: string): string {
  const nameOf = (id: string) => {
    const f = scenario.furniture.find((x) => x.id === id)
    return f ? (f.label ?? getCatalogItem(f.catalogId).name) : 'et møbel'
  }
  switch (issue.kind) {
    case 'overlap':
      return `Kolliderer med «${nameOf(issue.otherId)}»`
    case 'wall':
      return 'Står inni en vegg'
    case 'door':
      return 'Står i slagfeltet til en dør'
    case 'outside':
      return 'Står utenfor rommene'
    case 'clearance': {
      const c = getCatalogItem(itemCatalogId).clearance
      const need = { front: c.front, back: c.back, left: c.sides, right: c.sides }[issue.side]
      const by = 'wallId' in issue.blockedBy ? 'en vegg' : `«${nameOf(issue.blockedBy.furnitureId)}»`
      return `For lite fri plass ${SIDE_LABELS[issue.side]} (trenger ${Math.round(need * 100)} cm), blokkert av ${by}`
    }
  }
}
