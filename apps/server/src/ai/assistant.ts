import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { Project, ROOM_TYPES, type AssistantEvent, type ChatMessage } from '@romslig/shared'
import { MODEL, anthropic, explainApiError } from './client.ts'
import { buildTools } from './tools.ts'
import { Workspace, catalogText } from './workspace.ts'

export const AssistantRequest = z.object({
  project: Project,
  /** Room the user is asking about, or null for the whole apartment. */
  roomId: z.string().nullable(),
  message: z.string().trim().min(1).max(4000),
})
export type AssistantRequest = z.infer<typeof AssistantRequest>

const SYSTEM = `You are Romslig's renovation and interior design assistant for Norwegian apartments. The user is planning a renovation and works in a 2D/3D model of their apartment. Always answer in Norwegian (bokmål), in a warm, concrete and practical tone.

## How you work
- The current state of the apartment arrives as JSON in the user's message (<apartment>). Coordinates are meters in plan view: x to the right, y downwards. Furniture x,y is the centre of its footprint; rotation is degrees clockwise and 0 means the front faces +y (down in the plan).
- Answer questions directly when no change is needed. When you propose something concrete (a furniture layout, a wall change), build it: call create_variant, make the changes in that variant with the tools, then call view_variant to check the result and fix problems you can fix. You may create several variants when comparing alternatives (at most three).
- Never try to change the user's existing variants; they are read-only to you. The user decides which variant to keep.
- For furniture, prefer auto_place_furniture with a sensible list in priority order; use place_furniture only when you need a specific position. Remember that furniture needs free space (listed in the catalog) and that chairs may stand at tables.
- Use add_note for things worth keeping: material and colour palettes, priorities, rough cost ranges.
- Finish with a short summary: what each variant contains, the trade-offs, and anything the user must check. Keep it compact: short paragraphs or a few bullets, no long essays. Refer to variants by name.

## Safety and regulations (always pass these on when relevant)
- Removing, moving or making openings in a wall that is load bearing or of unknown status requires assessment by a structural engineer (RIB) and usually an application to the municipality. Never say a wall "is not load bearing" unless the data marks it so.
- Wet rooms (bad, wc, vaskerom) must be built by qualified professionals according to TEK17 and våtromsnormen.
- Electrical work requires an authorised electrician (NEK 400). Exterior walls, windows and changes to shared structures usually need consent from the housing association (sameie/borettslag).
- Cost figures are rough estimates in NOK and must be labelled as such. Do not invent product prices.

## Room types
${ROOM_TYPES.join(', ')}

## Furniture catalog (catalog_id | name | category | width×depth×height | free space needed)
${catalogText()}`

const HISTORY_LIMIT = 16

/** Earlier turns as plain text (no tool calls or thinking are replayed), alternating roles. */
function historyMessages(chat: ChatMessage[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  const out: Anthropic.Beta.Messages.BetaMessageParam[] = []
  for (const m of chat.slice(-HISTORY_LIMIT)) {
    const prev = out.at(-1)
    if (prev && prev.role === m.role && typeof prev.content === 'string') prev.content += `\n\n${m.text}`
    else out.push({ role: m.role, content: m.text })
  }
  while (out[0]?.role === 'assistant') out.shift()
  return out
}

function contextBlock(ws: Workspace, roomId: string | null): string {
  const room = ws.base.rooms.find((r) => r.id === roomId)
  const focus = room
    ? `The question is about the room «${room.name}» (id ${room.id}).`
    : 'The question is about the whole apartment.'
  const variants = ws.project.scenarios.map((s) => ({ id: s.id, name: s.name, current: s.id === ws.base.id }))
  return [
    `<apartment>\n${JSON.stringify(ws.describe(ws.base))}\n</apartment>`,
    `<variants>\n${JSON.stringify(variants)}\n</variants>`,
    `<ceiling_height_m>${ws.project.ceilingHeight}</ceiling_height_m>`,
    `<north>Plan "up" is ${ws.project.northAngle}° from true north (clockwise).</north>`,
    `<focus>${focus}</focus>`,
  ].join('\n')
}

/**
 * Runs one assistant turn: streams text and activity through `emit`, lets Claude use the tools on
 * a sandboxed copy of the project, and finishes with the new variants and notes.
 */
export async function runAssistant(req: AssistantRequest, emit: (e: AssistantEvent) => void, signal: AbortSignal) {
  const ws = new Workspace(req.project)
  const tools = buildTools(ws, (text) => emit({ type: 'activity', text }))
  const turns: string[] = []

  try {
    const runner = anthropic().beta.messages.toolRunner(
      {
        model: MODEL,
        max_tokens: 32000,
        stream: true,
        max_iterations: 16,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: 'high' },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools,
        messages: [
          ...historyMessages(req.project.chat),
          {
            role: 'user',
            content: [
              { type: 'text', text: contextBlock(ws, req.roomId) },
              { type: 'text', text: req.message },
            ],
          },
        ],
      },
      { signal },
    )

    for await (const stream of runner) {
      let text = ''
      stream.on('text', (delta) => {
        // Separate the text of consecutive turns with a blank line
        if (!text && turns.length) emit({ type: 'text', delta: '\n\n' })
        text += delta
        emit({ type: 'text', delta })
      })
      stream.on('thinking', (delta) => emit({ type: 'thinking', delta }))
      const message = await stream.finalMessage()
      if (text) turns.push(text)
      if (message.stop_reason === 'refusal') {
        emit({ type: 'error', message: 'Claude avslo denne forespørselen. Prøv å formulere den annerledes.' })
        return
      }
    }
    const final = await runner.done()
    if (final.stop_reason === 'max_tokens') turns.push('_(Svaret ble avkuttet fordi det ble for langt.)_')

    emit({ type: 'done', text: turns.join('\n\n'), scenarios: [...ws.drafts.values()], notes: ws.baseNotes })
  } catch (e) {
    if (signal.aborted) return
    const err = explainApiError(e)
    console.error('assistant failed:', err)
    emit({ type: 'error', message: err.message })
  }
}
