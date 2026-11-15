// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { estimateWidth } from './labelFit.ts'

// The module keeps the canvas context and a cache, so each test loads it afresh.
async function load() {
  vi.resetModules()
  return import('./measureText.ts')
}

function stubContext(width: (text: string) => number) {
  const ctx = { font: '', measureText: vi.fn((t: string) => ({ width: width(t) })) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  return ctx
}

describe('measureText', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('measures at a reference size with the Konva font string and scales to the size asked for', async () => {
    const ctx = stubContext((t) => t.length * 50)
    const { measureText, LABEL_FONT_FAMILY } = await load()

    expect(measureText('Stue', 20, false)).toBe(40)
    expect(ctx.font).toBe(`normal normal 100px ${LABEL_FONT_FAMILY}`)
    expect(measureText('Stue', 10, false)).toBe(20)
    expect(ctx.measureText).toHaveBeenCalledTimes(1)

    measureText('Stue', 10, true)
    expect(ctx.font).toBe('bold normal 100px Arial')
    expect(ctx.measureText).toHaveBeenCalledTimes(2)
  })

  it('starts the cache over when it grows large', async () => {
    const ctx = stubContext(() => 100)
    const { measureText } = await load()

    for (let i = 0; i <= 2001; i++) measureText(`t${i}`, 10, false)
    measureText('t0', 10, false)
    expect(ctx.measureText).toHaveBeenCalledTimes(2003)
  })

  it('falls back to the estimate without a canvas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { measureText } = await load()
    expect(measureText('Kjøkken', 12, true)).toBe(estimateWidth('Kjøkken', 12, true))
  })
})
