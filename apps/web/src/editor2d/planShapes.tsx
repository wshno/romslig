import type Konva from 'konva'
import { Group, Rect, Shape, Text } from 'react-konva'
import type { Vec2 } from '@romslig/shared'
import { plateSize } from './labelFit.ts'
import { LABEL_FONT_FAMILY, measureText } from './measureText.ts'
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

/** Background of plan labels: light and slightly see-through, so labels read over the plan image. */
export const PLATE_FILL = 'rgba(255, 255, 255, 0.82)'

/**
 * A single line of text on a rounded background plate, centred on `at` (world) and turned by
 * `rotation` degrees. Sizes are screen pixels, so the label keeps its size on screen at any zoom.
 * `dy` shifts it along its own vertical axis, in px.
 */
export function PlateText({
  at,
  text,
  scale,
  fontSize,
  color,
  bold = false,
  rotation = 0,
  dy = 0,
}: {
  at: Vec2
  text: string
  scale: number
  fontSize: number
  color: string
  bold?: boolean
  rotation?: number
  dy?: number
}) {
  const { width, height } = plateSize([{ text, fontSize, bold }], fontSize, measureText)
  const k = 1 / scale
  const x = (-width / 2) * k
  const y = (-height / 2 + dy) * k
  return (
    <Group x={at.x} y={at.y} rotation={rotation} listening={false}>
      <Rect x={x} y={y} width={width * k} height={height * k} cornerRadius={3 * k} fill={PLATE_FILL} />
      <Text
        x={x}
        y={y}
        width={width * k}
        height={height * k}
        align="center"
        verticalAlign="middle"
        wrap="none"
        text={text}
        fontSize={fontSize * k}
        fontFamily={LABEL_FONT_FAMILY}
        fontStyle={bold ? 'bold' : 'normal'}
        fill={color}
      />
    </Group>
  )
}

/** A short label just above `at`, such as a length while drawing or editing a wall. */
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
  return <PlateText at={at} text={text} scale={scale} fontSize={12} color={color} dy={-10} />
}
