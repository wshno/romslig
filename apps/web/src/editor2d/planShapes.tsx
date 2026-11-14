import type Konva from 'konva'
import { Shape, Text } from 'react-konva'
import type { Vec2 } from '@romslig/shared'
import { gridLines, gridSpacing, visibleRect } from './planStyle.ts'

/**
 * What the stage shows right now, in world meters. Read from the stage when drawing rather than
 * from React state, so it is also right while the stage is being dragged.
 */
function shownRect(shape: Konva.Shape) {
  const stage = shape.getStage()
  if (!stage) return null
  const scale = stage.scaleX()
  return { scale, ...visibleRect(stage.width(), stage.height(), { scale, x: stage.x(), y: stage.y() }) }
}

/** The background across the whole visible area; clicking it deselects (it is named "bg"). */
export function Background({ fill }: { fill: string }) {
  return (
    <Shape
      name="bg"
      fill={fill}
      perfectDrawEnabled={false}
      sceneFunc={(ctx, shape) => {
        const r = shownRect(shape)
        if (!r) return
        ctx.beginPath()
        ctx.rect(r.x, r.y, r.width, r.height)
        ctx.closePath()
        ctx.fillStrokeShape(shape)
      }}
    />
  )
}

/**
 * Grid lines across the visible area. Only the lines in view are drawn, and the spacing follows the
 * zoom (see gridSpacing), with a stronger line on the major spacing.
 */
export function Grid() {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx, shape) => {
        const r = shownRect(shape)
        if (!r || r.scale <= 0) return
        const { minor, major } = gridSpacing(r.scale)
        const x1 = r.x + r.width
        const y1 = r.y + r.height
        const stroke = (step: number, color: string, skip?: number) => {
          ctx.beginPath()
          for (const x of gridLines(r.x, x1, step, skip)) {
            ctx.moveTo(x, r.y)
            ctx.lineTo(x, y1)
          }
          for (const y of gridLines(r.y, y1, step, skip)) {
            ctx.moveTo(r.x, y)
            ctx.lineTo(x1, y)
          }
          ctx.setAttr('strokeStyle', color)
          ctx.setAttr('lineWidth', 1 / r.scale) // one screen pixel
          ctx.stroke()
        }
        stroke(minor, '#e9edf3', major)
        stroke(major, '#d9e0e9')
      }}
    />
  )
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
