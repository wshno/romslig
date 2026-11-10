import { Line, Text } from 'react-konva'
import type { Vec2 } from '@romslig/shared'

export function Grid({ w, h }: { w: number; h: number }) {
  const lines = []
  for (let x = 0; x <= Math.ceil(w); x++)
    lines.push(
      <Line
        key={`x${x}`}
        points={[x, 0, x, h]}
        stroke="#e2e8f0"
        strokeWidth={1}
        strokeScaleEnabled={false}
        listening={false}
      />,
    )
  for (let y = 0; y <= Math.ceil(h); y++)
    lines.push(
      <Line
        key={`y${y}`}
        points={[0, y, w, y]}
        stroke="#e2e8f0"
        strokeWidth={1}
        strokeScaleEnabled={false}
        listening={false}
      />,
    )
  return <>{lines}</>
}

export function Label({
  at,
  text,
  scale,
  color = '#0f172a',
}: {
  at: Vec2
  text: string
  scale: number
  color?: string
}) {
  const width = 160 / scale
  return (
    <Text
      x={at.x - width / 2}
      y={at.y - 16 / scale}
      width={width}
      align="center"
      text={text}
      fontSize={12 / scale}
      fill={color}
      listening={false}
      shadowColor="#fff"
      shadowBlur={4 / scale}
      shadowOpacity={1}
    />
  )
}
