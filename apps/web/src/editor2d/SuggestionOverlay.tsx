import { Group, Line } from 'react-konva'
import { add, mul, polygonCentroid, sub, wallDir, type Vec2 } from '@romslig/shared'
import { useStore } from '../store.ts'
import { Label } from './planShapes.tsx'
import { wallQuad } from './planStyle.ts'

export function SuggestionOverlay({ scale }: { scale: number }) {
  const s = useStore((st) => st.suggestion)!
  const project = useStore((st) => st.project)!
  // Suggestion geometry is in meters at the suggestion's scale; show it aligned with the image
  const k = s.pxPerMeter / project.calibration.pxPerMeter
  const t = (p: Vec2) => ({ x: p.x * k, y: p.y * k })
  const lines = s.walls.map((w) => ({ ...w, a: t(w.a), b: t(w.b), thickness: w.thickness * k }))
  return (
    <Group listening={false}>
      {s.rooms.map((r) => {
        const poly = r.polygon.map(t)
        return (
          <Group key={r.id}>
            <Line
              points={poly.flatMap((p) => [p.x, p.y])}
              closed
              fill="#fb923c"
              opacity={0.12}
              stroke="#ea580c"
              strokeWidth={1}
              dash={[6, 4]}
              strokeScaleEnabled={false}
            />
            <Label at={polygonCentroid(poly)} text={r.name} scale={scale} color="#c2410c" />
          </Group>
        )
      })}
      {lines.map((w) => (
        <Line key={w.id} points={wallQuad(w)} closed fill="#ea580c" opacity={0.7} />
      ))}
      {s.openings.map((o) => {
        const w = lines.find((x) => x.id === o.wallId)
        if (!w) return null
        const d = wallDir(w)
        const c = add(w.a, mul(d, o.offset * k))
        const half = mul(d, (o.width * k) / 2)
        const a = sub(c, half)
        const b = add(c, half)
        return (
          <Line
            key={o.id}
            points={[a.x, a.y, b.x, b.y]}
            stroke={o.kind === 'window' ? '#06b6d4' : '#fde047'}
            strokeWidth={4}
            strokeScaleEnabled={false}
          />
        )
      })}
    </Group>
  )
}
