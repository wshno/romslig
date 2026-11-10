import { digitizeScale, type PlanImageInput } from '@romslig/ai'
import type { Project, ProjectSummary } from '@romslig/shared'

/**
 * Who refused a request:
 * - `api`: our own API, with a message of its own (e.g. 409 when another device saved first)
 * - `login`: the login in front of the app, because the session has run out
 * - `edge`: something else on the way (a firewall, the gateway, a proxy), or nothing behind it answered
 */
export type ErrorSource = 'api' | 'login' | 'edge'

/** A request that was answered with an error, with its HTTP status and who it came from. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public source: ErrorSource = 'api',
  ) {
    super(message)
  }
}

/** A request that got no answer at all. It has no status, and may well pass if it is sent again. */
export class NetworkError extends Error {
  constructor() {
    super('Får ikke kontakt med Romslig. Sjekk nettforbindelsen og prøv igjen.')
  }
}

const LOGIN_EXPIRED = 'Innloggingen er utløpt. Logg inn igjen i en ny fane og prøv på nytt.'

function edgeMessage(status: number): string {
  if (status === 403)
    return `Forespørselen ble stoppet før den nådde Romslig (HTTP 403). En brannmur eller gateway foran appen avviste den.`
  if (status === 413) return `Opplastingen er for stor for brannmuren eller gatewayen foran Romslig (HTTP 413).`
  if (status >= 500) return `Romslig svarer ikke akkurat nå (HTTP ${status}). Prøv igjen om litt.`
  return `Uventet svar på vei til Romslig (HTTP ${status}). Det kom ikke fra appen.`
}

const isJson = (res: Response) => (res.headers.get('Content-Type') ?? '').includes('application/json')

/** The message of an error from our API: it always answers with JSON `{ error }`. Null for anything else. */
async function ownError(res: Response): Promise<string | null> {
  if (!isJson(res)) return null
  try {
    const body = (await res.json()) as { error?: unknown } | null
    return typeof body?.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

async function failure(res: Response): Promise<ApiError> {
  // Our API never redirects. A redirect is the login sending the browser to its sign-in page.
  if (res.type === 'opaqueredirect') return new ApiError(401, LOGIN_EXPIRED, 'login')
  const own = await ownError(res)
  if (own !== null) return new ApiError(res.status, own)
  if (res.status === 401) return new ApiError(401, LOGIN_EXPIRED, 'login')
  return new ApiError(res.status, edgeMessage(res.status), 'edge')
}

/**
 * Sends a request to our API and returns the answer when it is a success. Otherwise it throws an
 * error that says in plain words who refused: `ApiError`, or `NetworkError` when no answer came.
 *
 * `Accept` leaves out `text/html` so that the login answers a script with 401. Asked for a page,
 * it redirects to its sign-in page on another origin, which the browser reports as a failed fetch.
 */
async function send(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  let res: Response
  try {
    res = await fetch(url, { redirect: 'manual', ...init, headers })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    throw new NetworkError()
  }
  if (!res.ok) throw await failure(res)
  return res
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await send(url, init)
  if (res.status === 204) return undefined as T
  // A success that is not JSON is a page from something in front of the app
  if (!isJson(res)) throw new ApiError(res.status, edgeMessage(res.status), 'edge')
  return (await res.json()) as T
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
  /** Uploads (or replaces) the floor plan; the caller puts the answer into the project. */
  uploadPlan: async (id: string, image: File) => {
    const fd = new FormData()
    fd.set('image', await preparePlanPng(image))
    return req<{ planImage: NonNullable<Project['planImage']>; pxPerMeter: number }>(`/api/projects/${id}/plan`, {
      method: 'PUT',
      body: fd,
    })
  },
  planUrl: (id: string) => `/api/projects/${id}/plan`,
}

/**
 * Loads the project's floor plan and downscales it in the browser for digitizing (long edge
 * ≤ 1568 px, PNG, base64). `scale` maps original plan pixels to the image Claude sees.
 */
export async function preparePlanForAi(project: Project): Promise<{ image: PlanImageInput; scale: number }> {
  if (!project.planImage) throw new Error('Prosjektet har ingen plantegning.')
  const res = await send(api.planUrl(project.id), { headers: { Accept: 'image/*' } })
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
