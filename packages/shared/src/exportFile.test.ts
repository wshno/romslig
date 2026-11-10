import { describe, expect, it } from 'vitest'
import { EXPORT_FORMAT, EXPORT_VERSION, exportFileName, readProjectExport } from './exportFile.ts'
import { emptyScenario, type Project } from './model.ts'

const project = (): Project => {
  const s = emptyScenario()
  return {
    id: 'p_1',
    name: 'Hytta',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: false },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [s],
    activeScenarioId: s.id,
    chat: [],
    customFurniture: [],
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
}
const file = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: '2026-11-10T12:00:00.000Z',
    project: project(),
    plan: null,
    ...over,
  })

describe('exportFileName', () => {
  const when = new Date('2026-11-10T23:30:00Z')

  it('keeps letters and digits, Norwegian ones too, and joins the rest with hyphens', () => {
    expect(exportFileName('Hytta på fjellet (Ål) – 2. etg', when)).toBe(
      'romslig-hytta-på-fjellet-ål-2-etg-2026-11-10.json',
    )
  })

  it('leaves nothing a file system or a path could trip on', () => {
    expect(exportFileName('../..\\con: "a"|b?*<c>\u0000\n', when)).toBe('romslig-con-a-b-c-2026-11-10.json')
  })

  it('has a name for a project without letters, and cuts a long one by character', () => {
    expect(exportFileName(' (…) ', when)).toBe('romslig-prosjekt-2026-11-10.json')
    const long = exportFileName('𝔸'.repeat(100), when)
    expect(long).toBe(`romslig-${'𝔸'.repeat(60)}-2026-11-10.json`)
    expect(() => encodeURIComponent(long)).not.toThrow()
    expect(exportFileName(`${'a'.repeat(59)} b`, when)).toBe(`romslig-${'a'.repeat(59)}-2026-11-10.json`)
  })
})

describe('readProjectExport', () => {
  it('reads an export, fills in defaults and drops fields it does not know', () => {
    const p = project() as Record<string, unknown>
    delete p.chat
    const read = readProjectExport(file({ project: { ...p, extra: 1 }, plan: 'aGVp', somethingNew: true }))
    if (!read.ok) throw new Error(read.error)
    expect(read.file.plan).toBe('aGVp')
    expect(read.file.project.chat).toEqual([])
    expect(read.file.project).not.toHaveProperty('extra')
    expect(read.file).not.toHaveProperty('somethingNew')
  })

  it('says so when the file is not an export at all', () => {
    expect(readProjectExport('<html>')).toEqual({
      ok: false,
      error: 'Filen er ikke en Romslig-eksport (ugyldig JSON).',
    })
    for (const text of ['null', '[]', '"romslig-project"', '{}', JSON.stringify(project()), file({ format: 'annet' })])
      expect(readProjectExport(text)).toEqual({ ok: false, error: 'Filen er ikke en Romslig-eksport.' })
  })

  it('says so when the file comes from a newer version', () => {
    expect(readProjectExport(file({ version: 2 }))).toEqual({
      ok: false,
      error: 'Filen er laget av en nyere versjon av Romslig enn denne.',
    })
  })

  it('points at what is wrong in a damaged file', () => {
    const noVariants = readProjectExport(file({ project: { ...project(), scenarios: [] } }))
    expect(noVariants.ok).toBe(false)
    expect(!noVariants.ok && noVariants.error).toMatch(/^Filen er skadet eller endret \(project\.scenarios: /)

    const badWall = project()
    badWall.scenarios[0]!.walls = [{ id: 'w1' } as never]
    const read = readProjectExport(file({ project: badWall }))
    expect(!read.ok && read.error).toMatch(/^Filen er skadet eller endret \(project\.scenarios\.0\.walls\.0\./)

    for (const over of [{ plan: 5 }, { project: undefined }, { version: 0 }, { version: '1' }, { exportedAt: null }])
      expect(readProjectExport(file(over)).ok).toBe(false)
  })
})
