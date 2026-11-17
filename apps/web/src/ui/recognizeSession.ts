import type { PlanSide } from '@romslig/shared'

/** A photo for recognition, already downscaled in the browser (base64 JPEG), and the wall it faces. */
export interface PreparedPhoto {
  id: string
  mediaType: 'image/jpeg'
  data: string
  facing: PlanSide | null
}

/** The open recognition panel: which room, and the photos taken so far. */
export interface RecognizeSession {
  projectId: string
  roomId: string
  photos: PreparedPhoto[]
}

/**
 * Android may drop the browser tab while the camera app is open, and reload it on return. The
 * project itself is saved, but the panel's room and photos would be lost, so they are kept for
 * this tab only. The photos are the downscaled ones (a few hundred kB each), never the originals.
 */
const STORAGE_KEY = 'romslig.recognize'

/** The stored panel for this project, or null. A panel stored for another project is dropped. */
export function readSession(projectId: string): RecognizeSession | null {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Partial<RecognizeSession>
    if (s.projectId === projectId && typeof s.roomId === 'string' && Array.isArray(s.photos)) {
      return { projectId, roomId: s.roomId, photos: s.photos }
    }
  } catch {
    // Not ours or broken: fall through and drop it
  }
  clearSession()
  return null
}

/** Stores the panel. A full storage quota only costs the restore, so a failed write is ignored. */
export function writeSession(session: RecognizeSession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Over quota or storage blocked: try to keep at least the room, then give up quietly
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, photos: [] }))
    } catch {
      // Ignore
    }
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore
  }
}
