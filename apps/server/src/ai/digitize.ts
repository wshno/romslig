import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import sharp from 'sharp'
import {
  DEFAULTS,
  ROOM_TYPES,
  cleanupWalls,
  detectRoomPolygons,
  dist,
  lerp,
  nearestWall,
  newId,
  pointInPolygon,
  polygonArea,
  type DigitizeSuggestion,
  type Opening,
  type Project,
  type Room,
  type Wall,
} from '@romslig/shared'
import { HttpError, projectDir } from '../storage.ts'
import { MODEL, anthropic, explainApiError } from './client.ts'

/** What Claude returns, in pixel coordinates of the image it was shown. */
const DigitizeOutput = z.object({
  walls: z.array(
    z.object({
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      thickness_px: z.number(),
      exterior: z.boolean(),
    }),
  ),
  openings: z.array(
    z.object({
      kind: z.enum(['door', 'window', 'opening']),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
    }),
  ),
  rooms: z.array(
    z.object({
      name: z.string(),
      type: z.enum(ROOM_TYPES),
      stated_area_m2: z.number().nullable(),
      label_x: z.number(),
      label_y: z.number(),
    }),
  ),
  dimensions: z.array(
    z.object({
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      meters: z.number(),
    }),
  ),
  notes: z.string(),
})
type DigitizeOutput = z.infer<typeof DigitizeOutput>

const MAX_EDGE = 1568

const OPENING_NAMES = { door: 'dør', window: 'vindu', opening: 'åpning' } as const

const SYSTEM = `Du er en erfaren arkitekt som digitaliserer norske plantegninger (megler-/arkitekttegninger) til vektorgeometri.
Du får ett bilde av en plantegning. Returner geometrien i bildets pikselkoordinater (origo øverst til venstre, x mot høyre, y nedover).

Regler:
- Vegger: én linje per rett veggstykke, langs veggens SENTERLINJE, fra hjørne til hjørne. Del vegger der de møter andre vegger (T-kryss og hjørner). Vegger skal gå gjennom dører og vinduer (åpninger registreres separat). Endepunkter som møtes skal ha identiske koordinater.
- thickness_px: veggtykkelse i piksler slik den er tegnet. exterior=true for yttervegger.
- Åpninger: x1,y1 og x2,y2 er åpningens to ender langs veggen (dørblad-bredde / vinduskarm). kind: door, window, eller opening (åpning uten dør).
- Rom: ett per rom med romnavnet slik det står (f.eks. "Stue/kjøkken", "Sov 1", "Bad"), type fra listen, oppgitt areal i m² hvis det står (ellers null), og et punkt (label_x,label_y) som ligger inne i rommet.
- Målsetting: hvis tegningen har målelinjer eller en målestokk, legg inn hver av dem med endepunktene og lengden i meter (mm → m). Hvis ingen, tom liste.
- Ikke ta med møbler, sanitærutstyr, tekst eller skravur som vegger.
- notes: kort på norsk om usikkerhet (f.eks. utydelige vegger, mulig bærevegg-markering).`

export async function digitizeProject(project: Project): Promise<DigitizeSuggestion> {
  if (!project.planImage) throw new HttpError(400, 'Prosjektet har ingen plantegning')
  const file = path.join(projectDir(project.id), project.planImage.file)
  const original = await readFile(file)
  const { width: W, height: H } = project.planImage
  const f = Math.min(1, MAX_EDGE / Math.max(W, H)) // scaled = original * f
  const img = await sharp(original)
    .resize(Math.round(W * f), Math.round(H * f))
    .png()
    .toBuffer()

  let output: DigitizeOutput
  try {
    const stream = anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: z.toJSONSchema(DigitizeOutput) } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: img.toString('base64') } },
            {
              type: 'text',
              text: `Bildet er ${Math.round(W * f)}×${Math.round(H * f)} piksler. Digitaliser plantegningen.`,
            },
          ],
        },
      ],
    })
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') throw new HttpError(502, 'Claude avslo forespørselen. Prøv et annet bilde.')
    if (msg.stop_reason === 'max_tokens')
      throw new HttpError(502, 'Svaret fra Claude ble avkuttet (for stor tegning?).')
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    const parsed = DigitizeOutput.safeParse(JSON.parse(text))
    if (!parsed.success) throw new HttpError(502, 'Claude returnerte ugyldig geometri: ' + parsed.error.message)
    output = parsed.data
  } catch (e) {
    throw explainApiError(e)
  }

  return toSuggestion(output, project, f)
}

/** Converts Claude's pixel-space output to cleaned-up geometry in meters. Exported for tests. */
export function toSuggestion(out: DigitizeOutput, project: Project, f: number): DigitizeSuggestion {
  const warnings: string[] = []
  // Scale: original-image pixels per meter
  let pxPerMeter = project.calibration.pxPerMeter
  let scaleSource: DigitizeSuggestion['scaleSource'] = project.calibration.calibrated ? 'calibration' : 'none'
  if (!project.calibration.calibrated) {
    const ratios = out.dimensions
      .filter((d) => d.meters > 0.3)
      .map((d) => Math.hypot(d.x2 - d.x1, d.y2 - d.y1) / f / d.meters)
      .sort((a, b) => a - b)
    if (ratios.length) {
      pxPerMeter = ratios[Math.floor(ratios.length / 2)]!
      scaleSource = 'dimensions'
    }
  }
  const toM = (x: number, y: number) => ({ x: x / f / pxPerMeter, y: y / f / pxPerMeter })

  let walls: Wall[] = out.walls.map((w) => {
    const t = w.thickness_px / f / pxPerMeter
    const fallback = w.exterior ? DEFAULTS.exteriorWallThickness : DEFAULTS.interiorWallThickness
    return {
      id: newId('w_'),
      a: toM(w.x1, w.y1),
      b: toM(w.x2, w.y2),
      thickness: t > 0.04 && t < 0.6 ? Math.round(t * 100) / 100 : fallback,
      height: project.ceilingHeight,
      loadBearing: w.exterior ? 'yes' : 'unknown',
      exterior: w.exterior,
    }
  })
  walls = cleanupWalls(walls, 0.15)

  const openings: Opening[] = []
  for (const o of out.openings) {
    const a = toM(o.x1, o.y1)
    const b = toM(o.x2, o.y2)
    const mid = lerp(a, b, 0.5)
    const hit = nearestWall(mid, walls, 0.5)
    if (!hit) {
      warnings.push(`En ${OPENING_NAMES[o.kind]} lå ikke på noen vegg og ble hoppet over.`)
      continue
    }
    const d = DEFAULTS[o.kind]
    openings.push({
      id: newId('o_'),
      wallId: hit.wall.id,
      kind: o.kind,
      offset: hit.offset,
      width: Math.max(0.4, Math.round(dist(a, b) * 100) / 100),
      height: d.height,
      sill: d.sill,
      flip: false,
    })
  }

  const polys = detectRoomPolygons(walls)
  const rooms: Room[] = []
  const used = new Set<number>()
  for (const r of out.rooms) {
    const p = toM(r.label_x, r.label_y)
    const idx = polys.findIndex((poly, i) => !used.has(i) && pointInPolygon(p, poly))
    if (idx < 0) {
      warnings.push(`Fant ingen lukket vegg-sløyfe rundt «${r.name}». Sjekk at veggene henger sammen.`)
      continue
    }
    used.add(idx)
    rooms.push({ id: newId('r_'), name: r.name, type: r.type, polygon: polys[idx]!, statedArea: r.stated_area_m2 })
  }
  polys.forEach((poly, i) => {
    if (!used.has(i))
      rooms.push({ id: newId('r_'), name: `Rom ${rooms.length + 1}`, type: 'annet', polygon: poly, statedArea: null })
  })

  // No calibration and no dimension lines: derive the scale from stated room areas
  if (scaleSource === 'none') {
    const factors = rooms
      .filter((r) => r.statedArea && r.statedArea > 1)
      .map((r) => Math.sqrt(polygonArea(r.polygon) / r.statedArea!))
      .sort((a, b) => a - b)
    if (factors.length) {
      const k = factors[Math.floor(factors.length / 2)]! // current meters are k× too large
      const s = (v: { x: number; y: number }) => ({ x: v.x / k, y: v.y / k })
      walls = walls.map((w) => ({ ...w, a: s(w.a), b: s(w.b) }))
      for (const o of openings) {
        o.offset /= k
        o.width = Math.round((o.width / k) * 100) / 100
      }
      for (const r of rooms) r.polygon = r.polygon.map(s)
      pxPerMeter *= k
      scaleSource = 'areas'
      warnings.push('Målestokk er anslått ut fra oppgitte romarealer. Kalibrer gjerne manuelt for bedre presisjon.')
    } else {
      warnings.push('Fant ingen målestokk. Kalibrer tegningen og kjør digitaliseringen på nytt.')
    }
  }

  for (const r of rooms) {
    if (polygonArea(r.polygon) > 200) warnings.push(`«${r.name}» virker urimelig stort. Sjekk målestokken.`)
  }

  return { walls, openings, rooms, pxPerMeter, scaleSource, notes: out.notes, warnings }
}
