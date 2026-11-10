import { z } from 'zod'
import { Project } from './model.ts'

export const EXPORT_FORMAT = 'romslig-project'
export const EXPORT_VERSION = 1

/**
 * A project as a file: everything the project holds (variants, furniture, chat) and its floor
 * plan. Made for keeping a copy of your own and for moving a project between installations.
 */
export const ProjectExport = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  project: Project,
  /** The floor plan as a base64 PNG, or null when the project has none. */
  plan: z.string().nullable(),
})
export type ProjectExport = z.infer<typeof ProjectExport>

/**
 * A name as part of a file name: its letters and digits in lower case, everything else as single
 * hyphens, at most 60 characters. `fallback` is used for a name with no letter or digit in it.
 */
export function fileSlug(name: string, fallback: string): string {
  const words = name
    .normalize('NFC')
    .toLowerCase()
    // Every run of anything else becomes one hyphen, so there is at most one at each end
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
  // Cut by character, not by UTF-16 unit, so a letter outside the basic plane is never halved
  return Array.from(words).slice(0, 60).join('').replace(/-$/, '') || fallback
}

/** The name the file is saved under, e.g. "romslig-hytta-på-fjellet-2026-11-10.json". */
export function exportFileName(projectName: string, when: Date): string {
  return `romslig-${fileSlug(projectName, 'prosjekt')}-${when.toISOString().slice(0, 10)}.json`
}

export type ReadExport = { ok: true; file: ProjectExport } | { ok: false; error: string }

/**
 * Reads the text of an exported file. Says in Norwegian what is wrong with a file that is not
 * an export, comes from a newer version, or has been damaged or edited into something invalid.
 */
export function readProjectExport(text: string): ReadExport {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Filen er ikke en Romslig-eksport (ugyldig JSON).' }
  }
  const head = (typeof data === 'object' && data !== null ? data : {}) as { format?: unknown; version?: unknown }
  if (head.format !== EXPORT_FORMAT) return { ok: false, error: 'Filen er ikke en Romslig-eksport.' }
  if (typeof head.version === 'number' && head.version > EXPORT_VERSION)
    return { ok: false, error: 'Filen er laget av en nyere versjon av Romslig enn denne.' }
  const parsed = ProjectExport.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? issue.path.join('.') : 'filen'
    return { ok: false, error: `Filen er skadet eller endret (${where}: ${issue?.message ?? 'ugyldig'}).` }
  }
  return { ok: true, file: parsed.data }
}
