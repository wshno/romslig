import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  CATALOG,
  FURNITURE_CATEGORIES,
  FURNITURE_SHAPES,
  Project,
  setCustomCatalog,
  describeRoomSides,
  SIDE_NAMES,
  viewSides,
  type PlanSide,
  type Room,
  type Scenario,
  type RecognizeResult,
  type RecognizedItem,
} from '@romslig/shared'
import { AiError, MODEL, explainAiError, messageText } from './client.ts'
import { catalogText } from './workspace.ts'

export const RecognizeRequest = z.object({
  project: Project,
  roomId: z.string(),
  /** Free-text tips, e.g. "sengen er 180 cm bred". */
  hint: z.string().max(500).default(''),
  images: z
    .array(
      z.object({
        mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        /** Base64, already downscaled by the client. */
        data: z.string().max(4_000_000),
        /** The plan wall the photographer was facing, if the user marked it. */
        facing: z.enum(['top', 'right', 'bottom', 'left']).nullable().default(null),
      }),
    )
    .min(1)
    .max(4),
})
export type RecognizeRequest = z.infer<typeof RecognizeRequest>

const Proposal = z.object({
  name: z.string().describe('Generic Norwegian name for a catalog, e.g. "Hjørnesofa"'),
  name_en: z.string().describe('The same in English, e.g. "Corner sofa"'),
  category: z.enum(FURNITURE_CATEGORIES),
  shape: z.enum(FURNITURE_SHAPES).describe('Nearest existing 3D shape'),
  width_cm: z.number(),
  depth_cm: z.number(),
  height_cm: z.number(),
  clearance_front_cm: z.number(),
  clearance_sides_cm: z.number(),
  clearance_back_cm: z.number(),
  description_en: z.string().describe('One or two English sentences describing the real item: form, parts, features'),
  needs_new_shape: z.boolean().describe('True if a dedicated 3D shape would represent it much better'),
})

/** The answer schema; catalog ids include the project's own furniture. */
function outputSchema(ids: [string, ...string[]]) {
  return z.object({
    items: z.array(
      z.object({
        catalog_id: z.enum(ids).describe('Closest catalog item'),
        name: z.string().describe('Short Norwegian description of the actual item, e.g. "Grå 3-seter sofa"'),
        width_cm: z.number(),
        depth_cm: z.number(),
        height_cm: z.number(),
        side: z
          .enum(['top', 'right', 'bottom', 'left', 'free'])
          .describe('Plan side of the wall it stands against, or free'),
        position_hint: z.string().describe('Where in the room, in Norwegian, e.g. "under vinduet, til venstre"'),
        confidence: z.enum(['high', 'medium', 'low']),
        photo: z.number().describe('1-based index of the photo it is most visible in'),
        match: z.enum(['good', 'approximate', 'none']).describe('How well catalog_id fits the real item'),
        proposal: Proposal.nullable().describe('A new catalog item when match is approximate or none, else null'),
      }),
    ),
    notes: z.string().describe('Short Norwegian note: uncertainties, things not in the catalog'),
  })
}

const SYSTEM = `You identify the existing furniture in photos of a room, so it can be added to a floor-plan model of a Norwegian apartment. Answer in Norwegian in the text fields.

Rules:
- List each physical item once, even if it appears in several photos. Skip small objects (lamps, decorations, textiles) except rugs.
- Pick the closest catalog_id. When the real item differs from the catalog size, give your best estimate of its real size in cm; use doors (usually 80-90 cm wide, 200-210 cm high), standard kitchen modules (60 cm), beds (90/120/150/160/180 × 200 cm) and the user's hint as references.
- side: which wall of the floor plan the item stands against. When the user has said which wall a photo faces, that orientation is reliable: use the given mapping (ahead / left edge / right edge / behind) directly. Otherwise use the windows and doors in the room description to orient yourself (e.g. the bed stands against the wall opposite the window). Use "free" for items standing in the open floor. If you cannot tell, make the best guess and set confidence low.
- match: "good" when the catalog item has the same function and roughly the same form; "approximate" when the function matches but the form or proportions differ clearly (e.g. a corner sofa vs a straight sofa, a bunk bed vs a single bed, a round vs a square table); "none" when nothing in the catalog is similar (e.g. a piano, a treadmill). Items listed as the project's own furniture count as catalog items.
- proposal: for "approximate" and "none", propose a new catalog item with a generic name (not brand), the real size, a sensible free space, the nearest existing 3D shape, and set needs_new_shape when that shape represents it poorly. For "good", set proposal to null.
- Be honest about uncertainty in confidence and notes.

Catalog (catalog_id | name | category | width×depth×height | free space):
${catalogText()}`

/** Asks Claude what furniture the photos show and where it stands. Errors are AiError (Norwegian). */
export async function recognizeFurniture(
  client: Anthropic,
  req: RecognizeRequest,
  signal?: AbortSignal,
): Promise<RecognizeResult> {
  const scenario = req.project.scenarios.find((s) => s.id === req.project.activeScenarioId) ?? req.project.scenarios[0]!
  const room = scenario.rooms.find((r) => r.id === req.roomId)
  if (!room) throw new AiError('Fant ikke rommet.', 'invalid')

  const description = buildDescription(req, scenario, room)
  const own = req.project.customFurniture
  setCustomCatalog(own)
  const ids = [...CATALOG, ...own].map((c) => c.id) as [string, ...string[]]
  const Output = outputSchema(ids)

  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema: z.toJSONSchema(Output) } },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              ...req.images.map(
                (img) =>
                  ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }) as const,
              ),
              { type: 'text', text: description },
            ],
          },
        ],
      },
      { signal },
    )
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') throw new AiError('Claude avslo forespørselen.', 'refusal')
    if (msg.stop_reason === 'max_tokens') throw new AiError('Svaret fra Claude ble avkuttet.', 'truncated')
    const parsed = Output.safeParse(JSON.parse(messageText(msg)))
    if (!parsed.success) throw new AiError('Claude returnerte et ugyldig svar: ' + parsed.error.message, 'invalid')
    const known = new Set(ids)
    const items: RecognizedItem[] = parsed.data.items
      .filter((i) => known.has(i.catalog_id))
      .map((i) => ({
        catalogId: i.catalog_id,
        name: i.name,
        size: { w: i.width_cm / 100, d: i.depth_cm / 100, h: i.height_cm / 100 },
        side: i.side,
        positionHint: i.position_hint,
        confidence: i.confidence,
        photo: i.photo,
        match: i.match,
        proposal:
          i.match === 'good' || !i.proposal
            ? null
            : {
                name: i.proposal.name,
                nameEn: i.proposal.name_en,
                category: i.proposal.category,
                shape: i.proposal.shape,
                w: i.proposal.width_cm / 100,
                d: i.proposal.depth_cm / 100,
                h: i.proposal.height_cm / 100,
                clearance: {
                  front: i.proposal.clearance_front_cm / 100,
                  back: i.proposal.clearance_back_cm / 100,
                  sides: i.proposal.clearance_sides_cm / 100,
                },
                descriptionEn: i.proposal.description_en,
                needsNewShape: i.proposal.needs_new_shape,
              },
      }))
    return { roomId: room.id, items, notes: parsed.data.notes }
  } catch (e) {
    throw explainAiError(e)
  }
}

const wall = (side: PlanSide) => `veggen ${SIDE_NAMES[side]} (${side})`

/** The text sent with the photos: the room's walls, and for each photo which wall is where. */
export function buildDescription(req: RecognizeRequest, scenario: Scenario, room: Room): string {
  const photos = req.images.map((img, i) => {
    if (!img.facing) return `- Bilde ${i + 1}: retning ikke oppgitt.`
    const v = viewSides(img.facing)
    return `- Bilde ${i + 1}: tatt mot ${wall(v.ahead)}. Til venstre i bildet: ${wall(v.left)}. Til høyre i bildet: ${wall(v.right)}. Bak fotografen: ${wall(v.behind)}.`
  })
  const own = req.project.customFurniture
  return [
    `Rommet heter «${room.name}» (type ${room.type}). Veggene, sett i plantegningen:`,
    describeRoomSides(scenario, room.id),
    `Det er ${req.images.length} bilde(r), nummerert i rekkefølge:`,
    ...photos,
    req.hint ? `Tips fra brukeren: ${req.hint}` : '',
    own.length ? `Prosjektets egne møbler (bruk disse catalog_id-ene når de passer):\n${catalogText(own)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
