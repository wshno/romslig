import { estimateWidth, type Measure } from './labelFit.ts'

/** Font family of plan labels; Konva's default, also passed explicitly to the label Text nodes. */
export const LABEL_FONT_FAMILY = 'Arial'

/** Font size the browser measures at; widths scale linearly to the size asked for. */
const REF_SIZE = 100

let ctx: CanvasRenderingContext2D | null | undefined
const cache = new Map<string, number>()

function context(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  return ctx
}

/**
 * Measures text the way Konva draws it: the same canvas font string as a Konva Text in
 * LABEL_FONT_FAMILY (Konva sets `fontStyle fontVariant fontSizepx fontFamily`). Widths are cached
 * per text and weight. Falls back to the per-character estimate when there is no canvas.
 */
export const measureText: Measure = (text, fontSize, bold) => {
  const c = context()
  if (!c) return estimateWidth(text, fontSize, bold)
  const key = `${bold ? 'b' : 'n'}|${text}`
  let w = cache.get(key)
  if (w === undefined) {
    c.font = `${bold ? 'bold' : 'normal'} normal ${REF_SIZE}px ${LABEL_FONT_FAMILY}`
    w = c.measureText(text).width
    if (cache.size > 2000) cache.clear()
    cache.set(key, w)
  }
  return (w * fontSize) / REF_SIZE
}
