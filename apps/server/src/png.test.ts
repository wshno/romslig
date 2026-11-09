import { describe, expect, it } from 'vitest'
import { readPngSize } from './png.ts'
import { makePng } from './testutil.ts'

describe('readPngSize', () => {
  it('reads width and height from a PNG', () => {
    expect(readPngSize(makePng(37, 21))).toEqual({ width: 37, height: 21 })
  })
  it('rejects non-PNG data', () => {
    expect(() => readPngSize(new TextEncoder().encode('GIF89a not a png at all......'))).toThrow(/PNG/)
  })
})
