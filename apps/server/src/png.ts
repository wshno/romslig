import { HttpError } from './errors.ts'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
export const MAX_PLAN_BYTES = 15 * 1024 * 1024
const MAX_EDGE = 10000

/**
 * Checks that the bytes are a PNG (the browser converts uploads to PNG) and reads its size from
 * the IHDR chunk, so the server needs no image library.
 */
export function readPngSize(buf: Uint8Array): { width: number; height: number } {
  if (buf.length > MAX_PLAN_BYTES) throw new HttpError(413, 'Plantegningen er for stor (maks 15 MB).')
  if (buf.length < 24 || SIGNATURE.some((b, i) => buf[i] !== b))
    throw new HttpError(400, 'Plantegningen må være et PNG-bilde.')
  // IHDR is always the first chunk: length(4) "IHDR"(4) width(4) height(4)
  const type = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!)
  if (type !== 'IHDR') throw new HttpError(400, 'Ugyldig PNG-fil.')
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height || width > MAX_EDGE || height > MAX_EDGE)
    throw new HttpError(400, 'Plantegningen har ugyldige mål.')
  return { width, height }
}
