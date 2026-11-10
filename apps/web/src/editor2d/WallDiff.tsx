import { Group, Line } from 'react-konva'
import { dist, type Scenario, type Wall } from '@romslig/shared'
import { wallQuad } from './planStyle.ts'

const samePos = (a: Wall, b: Wall) => dist(a.a, b.a) + dist(a.b, b.b) < 0.01

/** Walls removed compared with `other` (red, dashed, where they used to be) and new/moved ones (green). */
export function WallDiff({ current, other }: { current: Scenario; other: Scenario }) {
  const removed = other.walls.filter((w) => {
    const now = current.walls.find((x) => x.id === w.id)
    return !now || !samePos(now, w)
  })
  const added = current.walls.filter((w) => {
    const before = other.walls.find((x) => x.id === w.id)
    return !before || !samePos(before, w)
  })
  return (
    <Group listening={false}>
      {removed.map((w) => (
        <Line
          key={`rm-${w.id}`}
          points={wallQuad(w)}
          closed
          fill="#fecaca"
          opacity={0.8}
          stroke="#dc2626"
          strokeWidth={2}
          dash={[6, 4]}
          strokeScaleEnabled={false}
        />
      ))}
      {added.map((w) => (
        <Line
          key={`add-${w.id}`}
          points={wallQuad(w)}
          closed
          stroke="#16a34a"
          strokeWidth={3}
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  )
}
