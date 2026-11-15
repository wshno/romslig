// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveFile, svgToPng, svgUrl } from './download.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('saveFile', () => {
  it('clicks a temporary download link and frees the data a minute later', () => {
    vi.useFakeTimers()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:romslig/1')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })

    saveFile('plan.png', new Blob(['x']))

    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toHaveAttribute('download', 'plan.png')
    expect(clicked[0]).toHaveAttribute('href', 'blob:romslig/1')
    expect(clicked[0]?.isConnected).toBe(false)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(revoke).toHaveBeenCalledWith('blob:romslig/1')
  })
})

describe('svgUrl', () => {
  it('encodes the SVG as a data address', () => {
    expect(svgUrl('<svg a="1"/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%221%22%2F%3E')
  })
})

describe('svgToPng', () => {
  /** jsdom never loads images: this one loads (or fails) at the given size as soon as it gets a src. */
  function stubImage(naturalWidth: number, naturalHeight: number, fails = false) {
    class FakeImage {
      naturalWidth = naturalWidth
      naturalHeight = naturalHeight
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => (fails ? this.onerror?.() : this.onload?.()))
      }
    }
    vi.stubGlobal('Image', FakeImage)
  }

  function stubCanvas(ctx: unknown, blob: Blob | null = new Blob(['png'], { type: 'image/png' })) {
    const sizes: [number, number][] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push([this.width, this.height])
      return ctx as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(blob))
    return sizes
  }

  it('draws the SVG on white at the asked long edge', async () => {
    stubImage(400, 200)
    const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
    const sizes = stubCanvas(ctx)

    const png = await svgToPng('<svg/>', 1000)

    expect(png.type).toBe('image/png')
    expect(sizes).toEqual([[1000, 500]])
    expect(ctx.fillStyle).toBe('#fff')
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1000, 500)
  })

  it('fails when the image does not load', async () => {
    stubImage(1, 1, true)
    await expect(svgToPng('<svg/>')).rejects.toThrow('Kunne ikke lage bildet.')
  })

  it('fails without a canvas context', async () => {
    stubImage(10, 10)
    stubCanvas(null)
    await expect(svgToPng('<svg/>')).rejects.toThrow('Kunne ikke lage bildet.')
  })

  it('fails when the canvas gives no PNG', async () => {
    stubImage(10, 10)
    stubCanvas({ fillRect: vi.fn(), drawImage: vi.fn() }, null)
    await expect(svgToPng('<svg/>')).rejects.toThrow('Kunne ikke lage bildet.')
  })
})
