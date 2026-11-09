import type {
  AssistantEvent,
  DigitizeSuggestion,
  PlanSide,
  Project,
  ProjectSummary,
  RecognizeResult,
} from '@romslig/shared'

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
  health: () => req<{ ok: boolean; ai: boolean }>('/api/health'),
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
  digitize: (id: string) => req<DigitizeSuggestion>(`/api/projects/${id}/digitize`, { method: 'POST' }),
}

/**
 * Asks the assistant and yields its server-sent events as they arrive. The request carries the
 * current project, so the assistant sees unsaved edits too.
 */
export async function* askAssistant(
  project: Project,
  roomId: string | null,
  message: string,
  signal: AbortSignal,
): AsyncGenerator<AssistantEvent> {
  const res = await fetch(`/api/projects/${project.id}/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, roomId, message }),
    signal,
  })
  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      /* not JSON */
    }
    throw new Error(msg)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (data) yield JSON.parse(data) as AssistantEvent
    }
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

export const recognize = (
  project: Project,
  roomId: string,
  hint: string,
  images: { mediaType: 'image/jpeg'; data: string; facing: PlanSide | null }[],
) =>
  req<RecognizeResult>(`/api/projects/${project.id}/recognize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, roomId, hint, images }),
  })
