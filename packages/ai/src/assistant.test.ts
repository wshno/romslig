import { describe, expect, it } from 'vitest'
import { emptyScenario, type AssistantEvent, type Project } from '@romslig/shared'
import { runAssistant } from './assistant.ts'
import { errorResponse, fakeClient } from './testing.ts'

function project(): Project {
  const s = emptyScenario()
  return {
    id: 'p',
    name: 'p',
    planImage: null,
    calibration: { pxPerMeter: 100, calibrated: true },
    ceilingHeight: 2.4,
    northAngle: 0,
    scenarios: [s],
    activeScenarioId: s.id,
    chat: [],
    version: 0,
    createdAt: '',
    updatedAt: '',
  }
}

describe('runAssistant', () => {
  it('streams text, runs tools on the sandbox and finishes with the new variants', async () => {
    const { client, requests } = fakeClient([
      {
        content: [
          { type: 'text', text: 'Jeg lager en variant.' },
          { type: 'tool_use', id: 'tu_1', name: 'create_variant', input: { name: 'Ny stue', base_scenario_id: null } },
        ],
      },
      { content: [{ type: 'text', text: 'Ferdig.' }] },
    ])
    const events: AssistantEvent[] = []
    await runAssistant(
      client,
      { project: project(), roomId: null, message: 'Hjelp' },
      (e) => events.push(e),
      new AbortController().signal,
    )

    expect(events.filter((e) => e.type === 'activity')).toEqual([{ type: 'activity', text: 'Lager variant «Ny stue»' }])
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.text).toBe('Jeg lager en variant.\n\nFerdig.')
    expect(done.scenarios.map((s) => s.name)).toEqual(['Ny stue'])

    // Same request shape as the server used to send
    expect(requests).toHaveLength(2)
    const body = requests[0]!.body
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      stream: true,
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
    })
    expect(requests[0]!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect((body.tools as { eager_input_streaming?: boolean }[]).every((t) => t.eager_input_streaming)).toBe(true)
    // The tool result goes back in the second request
    expect(JSON.stringify(requests[1]!.body.messages)).toContain('tool_result')
  })

  it('emits a Norwegian error when the key is rejected', async () => {
    const { client } = fakeClient([errorResponse(401, 'authentication_error', 'invalid x-api-key')])
    const events: AssistantEvent[] = []
    await runAssistant(
      client,
      { project: project(), roomId: null, message: 'Hei' },
      (e) => events.push(e),
      new AbortController().signal,
    )
    expect(events).toEqual([{ type: 'error', message: expect.stringMatching(/^Anthropic-nøkkelen ble avvist/) }])
  })

  it('stays silent when aborted', async () => {
    const abort = new AbortController()
    abort.abort()
    const { client } = fakeClient([{ content: [{ type: 'text', text: 'x' }] }])
    const events: AssistantEvent[] = []
    await runAssistant(
      client,
      { project: project(), roomId: null, message: 'Hei' },
      (e) => events.push(e),
      abort.signal,
    )
    expect(events).toEqual([])
  })
})
