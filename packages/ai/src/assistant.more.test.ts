import { describe, expect, it } from 'vitest'
import { emptyScenario, type AssistantEvent, type ChatMessage, type Project } from '@romslig/shared'
import { runAssistant } from './assistant.ts'
import { fakeClient, type FakeTurn } from './testing.ts'

const msg = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({
  id,
  role,
  text,
  createdAt: '',
  roomId: null,
  scenarioIds: [],
})

function project(chat: ChatMessage[] = []): Project {
  const s = {
    ...emptyScenario(),
    rooms: [{ id: 'r_1', name: 'Stue', type: 'stue' as const, polygon: [], statedArea: null }],
  }
  return {
    id: 'p',
    name: 'p',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: true },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [s],
    activeScenarioId: s.id,
    chat,
    customFurniture: [],
    version: 0,
    createdAt: '',
    updatedAt: '',
  }
}

async function run(turns: FakeTurn[], p = project(), roomId: string | null = null) {
  const { client, requests } = fakeClient(turns)
  const events: AssistantEvent[] = []
  await runAssistant(
    client,
    { project: p, roomId, message: 'Hei' },
    (e) => events.push(e),
    new AbortController().signal,
  )
  return { events, requests }
}

describe('runAssistant', () => {
  it('replays earlier turns as alternating text, starting with the user', async () => {
    const chat = [
      msg('1', 'assistant', 'Velkommen'),
      msg('2', 'user', 'Første'),
      msg('3', 'user', 'Andre'),
      msg('4', 'assistant', 'Svar'),
    ]
    const { requests } = await run([{ content: [{ type: 'text', text: 'Ok' }] }], project(chat))

    const messages = requests[0]!.body.messages as { role: string; content: unknown }[]
    expect(messages.slice(0, 2)).toEqual([
      { role: 'user', content: 'Første\n\nAndre' },
      { role: 'assistant', content: 'Svar' },
    ])
  })

  it('tells Claude which room the question is about', async () => {
    const { requests } = await run([{ content: [{ type: 'text', text: 'Ok' }] }], project(), 'r_1')
    expect(JSON.stringify(requests[0]!.body.messages)).toContain('«Stue» (id r_1)')
  })

  it('reports a refusal in Norwegian and stops', async () => {
    const { events } = await run([{ content: [{ type: 'text', text: 'Nei' }], stop_reason: 'refusal' }])
    expect(events.at(-1)).toEqual({ type: 'error', message: expect.stringMatching(/^Claude avslo/) })
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('says so when the answer was cut off', async () => {
    const { events } = await run([{ content: [{ type: 'text', text: 'Langt svar' }], stop_reason: 'max_tokens' }])
    expect(events.at(-1)).toMatchObject({ type: 'done', text: expect.stringMatching(/avkuttet/) })
  })
})
