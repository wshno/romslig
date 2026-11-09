import { Circle, Group, Line, Rect, Text } from 'react-konva'
import {
  FIXTURE_INFO,
  RUN_INFO,
  polygonCentroid,
  type Fixture,
  type Scenario,
  type Vec2,
  type Wall,
} from '@romslig/shared'
import { beginGesture, endGesture, useStore, type Selection } from '../store.ts'
import { CATEGORY_COLORS, fixturePlacement } from './installationUtils.ts'

const RUN_DASH: Record<string, number[] | undefined> = {
  wall: undefined,
  floor: [10, 5],
  ceiling: [2, 4],
  lowered_ceiling: [8, 3, 2, 3],
}

interface Props {
  scenario: Scenario
  scale: number
  interactive: boolean
  selection: Selection
}

/** Lowered ceilings, runs (pipes, ducts, cables) and fixtures in plan view. */
export function Installations2D({ scenario, scale, interactive, selection }: Props) {
  const { select, updateFixture, updateRun } = useStore.getState()
  const px = (n: number) => n / scale
  const selectable = (kind: NonNullable<Selection>['kind'], id: string) => ({
    onMouseDown: (e: { cancelBubble: boolean }) => {
      if (!interactive) return
      e.cancelBubble = true
      select({ kind, id })
    },
    onClick: (e: { cancelBubble: boolean }) => {
      if (interactive) e.cancelBubble = true
    },
  })

  return (
    <Group>
      {scenario.loweredCeilings.map((c) => {
        const sel = selection?.id === c.id
        const centre = polygonCentroid(c.polygon)
        return (
          <Group key={c.id} {...selectable('ceiling', c.id)}>
            <Line
              points={c.polygon.flatMap((p) => [p.x, p.y])}
              closed
              fill="#a78bfa"
              opacity={sel ? 0.35 : 0.18}
              stroke="#7c3aed"
              strokeWidth={sel ? 2.5 : 1.5}
              dash={[6, 4]}
              strokeScaleEnabled={false}
            />
            <Text
              x={centre.x - px(80)}
              y={centre.y + px(22)}
              width={px(160)}
              align="center"
              text={`${c.label ?? 'Nedforet tak'} ${c.height.toFixed(2).replace('.', ',')} m`}
              fontSize={px(11)}
              fill="#6d28d9"
              listening={false}
            />
          </Group>
        )
      })}

      {scenario.runs.map((r) => {
        const info = RUN_INFO[r.kind]
        const sel = selection?.id === r.id
        const width = Math.max(2, Math.min(14, r.diameter * scale))
        return (
          <Group key={r.id}>
            <Line
              points={r.points.flatMap((p) => [p.x, p.y])}
              stroke={info.color}
              strokeWidth={sel ? width + 3 : width}
              opacity={r.kind === 'vent_duct' ? 0.7 : 0.95}
              lineCap="round"
              lineJoin="round"
              dash={RUN_DASH[r.placement]}
              hitStrokeWidth={12}
              strokeScaleEnabled={false}
              shadowColor={sel ? '#2563eb' : undefined}
              shadowBlur={sel ? 6 : 0}
              {...selectable('run', r.id)}
            />
            {sel &&
              interactive &&
              r.points
                .map((p, i) => ({ p, i, key: `${r.id}-v${i}` }))
                .map(({ p, i, key }) => (
                  <Circle
                    key={key}
                    x={p.x}
                    y={p.y}
                    radius={px(5)}
                    fill="#fff"
                    stroke={info.color}
                    strokeWidth={2}
                    strokeScaleEnabled={false}
                    draggable
                    onMouseDown={(e) => (e.cancelBubble = true)}
                    onDragStart={(e) => {
                      e.cancelBubble = true
                      beginGesture()
                    }}
                    onDragMove={(e) => {
                      e.cancelBubble = true
                      const points = r.points.map((q, j) => (j === i ? { x: e.target.x(), y: e.target.y() } : q))
                      updateRun(r.id, { points })
                    }}
                    onDragEnd={(e) => {
                      e.cancelBubble = true
                      endGesture()
                    }}
                  />
                ))}
          </Group>
        )
      })}

      {scenario.fixtures.map((fx) => (
        <FixtureSymbol
          key={fx.id}
          fx={fx}
          scale={scale}
          selected={selection?.id === fx.id}
          interactive={interactive}
          walls={scenario.walls}
          onSelect={() => select({ kind: 'fixture', id: fx.id })}
          onMove={(point, wallId) => updateFixture(fx.id, { x: point.x, y: point.y, wallId })}
        />
      ))}
    </Group>
  )
}

function FixtureSymbol(props: {
  fx: Fixture
  scale: number
  selected: boolean
  interactive: boolean
  walls: Wall[]
  onSelect(): void
  onMove(p: Vec2, wallId: string | null): void
}) {
  const { fx, scale, selected } = props
  const info = FIXTURE_INFO[fx.kind]
  const color = CATEGORY_COLORS[info.category]
  const r = 8 / scale
  const big = fx.kind === 'fuse_box'
  return (
    <Group
      x={fx.x}
      y={fx.y}
      draggable={props.interactive && selected}
      onMouseDown={(e) => {
        if (!props.interactive) return
        e.cancelBubble = true
        props.onSelect()
      }}
      onClick={(e) => {
        if (props.interactive) e.cancelBubble = true
      }}
      onDragStart={(e) => {
        e.cancelBubble = true
        beginGesture()
      }}
      onDragMove={(e) => {
        e.cancelBubble = true
        const placed = fixturePlacement({ x: e.target.x(), y: e.target.y() }, props.walls, 16 / scale, fx.kind)
        e.target.position(placed.point)
        props.onMove(placed.point, placed.wallId)
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        endGesture()
      }}
    >
      {big ? (
        <Rect
          x={-r * 1.6}
          y={-r * 1.2}
          width={r * 3.2}
          height={r * 2.4}
          fill="#fef9c3"
          stroke={selected ? '#2563eb' : color}
          strokeWidth={selected ? 3 : 2}
          strokeScaleEnabled={false}
          cornerRadius={r * 0.2}
        />
      ) : (
        <Circle
          radius={r}
          fill="#fff"
          stroke={selected ? '#2563eb' : color}
          strokeWidth={selected ? 3 : 2}
          strokeScaleEnabled={false}
        />
      )}
      <Text
        x={-r * 1.6}
        y={-r * 0.55}
        width={r * 3.2}
        align="center"
        text={info.symbol}
        fontSize={r * (info.symbol.length > 1 ? 0.95 : 1.15)}
        fontStyle="bold"
        fill={color}
        listening={false}
      />
      {selected && (
        <Text
          x={-60 / scale}
          y={r + 3 / scale}
          width={120 / scale}
          align="center"
          text={`${fx.label ?? info.name} · ${Math.round(fx.z * 100)} cm`}
          fontSize={10 / scale}
          fill="#0f172a"
          listening={false}
        />
      )}
    </Group>
  )
}
