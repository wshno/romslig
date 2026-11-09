import {
  SIDE_NAMES,
  add,
  clampOpening,
  closestPointOnSegment,
  mul,
  polygonCentroid,
  roomEdges,
  wallDir,
  type PlanSide,
  type Room,
  type Scenario,
} from '@romslig/shared'

const W = 150
const H = 110
const PAD = 14

const OUTWARD: Record<PlanSide, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/**
 * A small plan of the room with its windows and doors. Click the wall you were facing when you
 * took the photo; a camera shows the direction.
 */
export function DirectionPicker({
  scenario,
  room,
  value,
  onChange,
}: {
  scenario: Scenario
  room: Room
  value: PlanSide | null
  onChange(side: PlanSide | null): void
}) {
  const xs = room.polygon.map((p) => p.x)
  const ys = room.polygon.map((p) => p.y)
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  const k = Math.min((W - 2 * PAD) / (Math.max(...xs) - x0 || 1), (H - 2 * PAD) / (Math.max(...ys) - y0 || 1))
  const ox = (W - (Math.max(...xs) - x0) * k) / 2
  const oy = (H - (Math.max(...ys) - y0) * k) / 2
  const t = (p: { x: number; y: number }) => ({ x: ox + (p.x - x0) * k, y: oy + (p.y - y0) * k })

  const edges = roomEdges(room.polygon).filter((e) => e.side && e.length > 0.3)
  // Windows and doors that sit on this room's edges
  const features = scenario.openings.flatMap((o) => {
    const w = scenario.walls.find((x) => x.id === o.wallId)
    if (!w) return []
    const { start, end } = clampOpening(o, w)
    const d = wallDir(w)
    const centre = add(w.a, mul(d, (start + end) / 2))
    const onEdge = edges.some((e) => closestPointOnSegment(centre, e.a, e.b).dist <= w.thickness / 2 + 0.1)
    if (!onEdge) return []
    return [{ id: o.id, kind: o.kind, a: t(add(w.a, mul(d, start))), b: t(add(w.a, mul(d, end))) }]
  })

  const c = t(polygonCentroid(room.polygon))
  let camera: string | null = null
  let cameraAt: { x: number; y: number } | null = null
  if (value) {
    const dir = OUTWARD[value]
    const cam = { x: c.x - dir.x * 18, y: c.y - dir.y * 14 }
    const tip = { x: c.x + dir.x * 16, y: c.y + dir.y * 12 }
    const side = { x: -dir.y * 9, y: dir.x * 9 }
    camera = `${cam.x},${cam.y} ${tip.x + side.x},${tip.y + side.y} ${tip.x - side.x},${tip.y - side.y}`
    cameraAt = cam
  }

  return (
    <div className="direction-picker">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Velg veggen du ser mot">
        <polygon points={room.polygon.map((p) => `${t(p).x},${t(p).y}`).join(' ')} fill="#eef2ff" />
        {edges.map((e) => {
          const a = t(e.a)
          const b = t(e.b)
          const active = e.side === value
          return (
            <g key={`${a.x}:${a.y}:${b.x}:${b.y}`} className="edge" onClick={() => onChange(active ? null : e.side)}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={16} />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? '#2563eb' : '#64748b'}
                strokeWidth={active ? 5 : 3}
                strokeLinecap="round"
              />
            </g>
          )
        })}
        {features.map((f) => (
          <line
            key={f.id}
            x1={f.a.x}
            y1={f.a.y}
            x2={f.b.x}
            y2={f.b.y}
            stroke={f.kind === 'window' ? '#38bdf8' : '#a16207'}
            strokeWidth={4}
            pointerEvents="none"
          />
        ))}
        {camera && <polygon points={camera} fill="#93c5fd" opacity={0.7} pointerEvents="none" />}
        {cameraAt && <circle cx={cameraAt.x} cy={cameraAt.y} r={4.5} fill="#1d4ed8" pointerEvents="none" />}
      </svg>
      <span className={value ? '' : 'muted'}>
        {value ? `Ser mot veggen ${SIDE_NAMES[value]}` : 'Klikk på veggen du så mot'}
      </span>
    </div>
  )
}
