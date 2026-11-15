// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@romslig/shared'
import { api, ApiError, preparePlanForAi, preparePlanPng, prepareImage } from './api.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function answer(res: () => Response) {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => Promise.resolve(res()))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** jsdom has no canvas or image decoding: these stand in for what the browser does. */
function stubImages(size = { width: 8000, height: 4000 }) {
  const bitmap = { ...size, close: vi.fn() }
  const createImageBitmap = vi.fn(() => Promise.resolve(bitmap))
  vi.stubGlobal('createImageBitmap', createImageBitmap)
  const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '', imageSmoothingQuality: '' }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,QUJD')
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })))
  return { bitmap, ctx, createImageBitmap, toBlob }
}

const photo = () => new File(['jpg'], 'plan.jpg', { type: 'image/jpeg' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the API calls', () => {
  it('reach the right address with the right method', async () => {
    const fetch = answer(() => json({ ok: true }))

    await api.health()
    await api.get('p_1')
    await api.rename('p_1', 'Hytta')
    await api.copy('p_1')
    await api.exportFile('p_1')
    await api.importFile(new File(['{}'], 'hytta.romslig.json'))

    const calls = fetch.mock.calls.map(([url, init]) => `${init.method ?? 'GET'} ${url}`)
    expect(calls).toEqual([
      'GET /api/health',
      'GET /api/projects/p_1',
      'PATCH /api/projects/p_1',
      'POST /api/projects/p_1/copy',
      'GET /api/projects/p_1/export',
      'POST /api/projects/import',
    ])
    expect(fetch.mock.calls[2]![1].body).toBe('{"name":"Hytta"}')
    expect((fetch.mock.calls[5]![1].body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('build the plan and thumbnail addresses', () => {
    expect(api.planUrl('p_1')).toBe('/api/projects/p_1/plan')
    expect(api.thumbnailUrl({ id: 'p_1', updatedAt: '2026-11-15T01:00:00+01:00' })).toBe(
      '/api/projects/p_1/thumbnail?v=2026-11-15T01%3A00%3A00%2B01%3A00',
    )
  })

  it('create a project without a plan, and with one turned into a PNG', async () => {
    stubImages()
    const fetch = answer(() => json({ id: 'p_2' }))

    await api.create('Uten plan', null)
    await api.create('Med plan', photo())

    const without = fetch.mock.calls[0]![1].body as FormData
    const withPlan = fetch.mock.calls[1]![1].body as FormData
    expect(without.get('name')).toBe('Uten plan')
    expect(without.has('image')).toBe(false)
    expect((withPlan.get('image') as File).type).toBe('image/png')
  })

  it('upload a new plan as a PNG', async () => {
    stubImages()
    const fetch = answer(() => json({ planImage: { width: 1, height: 1 }, pxPerMeter: 50 }))

    await expect(api.uploadPlan('p_1', photo())).resolves.toMatchObject({ pxPerMeter: 50 })
    expect(fetch.mock.calls[0]![0]).toBe('/api/projects/p_1/plan')
    expect(fetch.mock.calls[0]![1].method).toBe('PUT')
  })

  it('treat a JSON error body that cannot be read as not from our API', async () => {
    answer(() => new Response('{broken', { status: 500, headers: { 'Content-Type': 'application/json' } }))
    await expect(api.list()).rejects.toMatchObject({ status: 500, source: 'edge' })
    await expect(api.list()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('preparing images', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('caps the long edge of an uploaded plan, on white', async () => {
    const { ctx, bitmap, createImageBitmap } = stubImages({ width: 8000, height: 4000 })

    const file = await preparePlanPng(photo(), 6000)

    expect(file).toMatchObject({ name: 'plan.png', type: 'image/png' })
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'from-image' })
    expect(ctx.fillStyle).toBe('#ffffff')
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 6000, 3000)
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('fails when the browser cannot encode the plan', async () => {
    const { toBlob } = stubImages({ width: 10, height: 10 })
    toBlob.mockImplementation((cb) => cb(null))

    await expect(preparePlanPng(photo())).rejects.toThrow('Klarte ikke å lese bildet.')
  })

  it('downscales a photo to a JPEG of at most 1568 px', async () => {
    const { ctx, bitmap } = stubImages({ width: 3136, height: 1000 })

    await expect(prepareImage(photo())).resolves.toEqual({ mediaType: 'image/jpeg', data: 'QUJD' })
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1568, 500)
  })

  it('loads the stored plan and scales it for the AI', async () => {
    const { ctx } = stubImages({ width: 3000, height: 2000 })
    const fetch = answer(() => new Response(new Blob(['png']), { status: 200 }))
    const project = { id: 'p_1', planImage: { width: 3000, height: 2000 } } as unknown as Project

    const { image, scale } = await preparePlanForAi(project)

    expect(fetch.mock.calls[0]![0]).toBe('/api/projects/p_1/plan')
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('Accept')).toBe('image/*')
    expect(scale).toBeLessThan(1)
    expect(image).toMatchObject({ mediaType: 'image/png', data: 'QUJD', width: Math.round(3000 * scale) })
    expect(ctx.imageSmoothingQuality).toBe('high')
  })

  it('refuses a project without a plan', async () => {
    await expect(preparePlanForAi({ id: 'p_1', planImage: null } as unknown as Project)).rejects.toThrow(
      'Prosjektet har ingen plantegning.',
    )
  })
})
