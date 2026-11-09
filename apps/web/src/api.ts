import { digitizeScale, type PlanImageInput } from '@romslig/ai'
import type { Project, ProjectSummary } from '@romslig/shared'

/** An error response from our API, with its HTTP status (e.g. 409 when another device saved first). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

/**
 * Turns an uploaded floor plan (JPG, PNG, WebP…) into a PNG in the browser, honouring the
 * camera orientation and capping the long edge, so the server needs no image library.
 */
export async function preparePlanPng(file: File, maxEdge = 6000): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff' // transparent areas become white, like paper
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Klarte ikke å lese bildet.'))), 'image/png'),
  )
  return new File([blob], 'plan.png', { type: 'image/png' })
}

export const api = {
  health: () => req<{ ok: boolean }>('/api/health'),
  list: () => req<ProjectSummary[]>('/api/projects'),
  get: (id: string) => req<Project>(`/api/projects/${id}`),
  create: async (name: string, image: File | null) => {
    const fd = new FormData()
    fd.set('name', name)
    if (image) fd.set('image', await preparePlanPng(image))
    return req<Project>('/api/projects', { method: 'POST', body: fd })
  },
  /** Saves if the stored version is still `version`; throws ApiError 409 otherwise. */
  save: (p: Project, version: number) =>
    req<Project>(`/api/projects/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(version) },
      body: JSON.stringify(p),
    }),
  remove: (id: string) => req<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  planUrl: (id: string) => `/api/projects/${id}/plan`,
}

/**
 * Loads the project's floor plan and downscales it in the browser for digitizing (long edge
 * ≤ 1568 px, PNG, base64). `scale` maps original plan pixels to the image Claude sees.
 */
export async function preparePlanForAi(project: Project): Promise<{ image: PlanImageInput; scale: number }> {
  if (!project.planImage) throw new Error('Prosjektet har ingen plantegning.')
  const res = await fetch(api.planUrl(project.id))
  if (!res.ok) throw new ApiError(res.status, 'Kunne ikke hente plantegningen.')
  const bitmap = await createImageBitmap(await res.blob())
  const { width: W, height: H } = project.planImage
  const scale = digitizeScale(W, H)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(W * scale)
  canvas.height = Math.round(H * scale)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/png')
  return {
    image: {
      mediaType: 'image/png',
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      width: canvas.width,
      height: canvas.height,
    },
    scale,
  }
}

/** Downscales a photo in the browser (long edge ≤ 1568 px, JPEG) and returns it as base64. */
export async function prepareImage(file: File): Promise<{ mediaType: 'image/jpeg'; data: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { mediaType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
}
