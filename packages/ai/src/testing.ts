import Anthropic from '@anthropic-ai/sdk'

/** One content block of a fake streamed response. */
export type FakeBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }

export interface FakeTurn {
  content: FakeBlock[]
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal'
}

/** The SSE body Anthropic sends for a streamed message with these blocks. */
export function sseBody(turn: FakeTurn): string {
  const events: [string, unknown][] = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ],
  ]
  turn.content.forEach((b, index) => {
    if (b.type === 'text') {
      events.push([
        'content_block_start',
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      ])
      events.push([
        'content_block_delta',
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } },
      ])
    } else {
      events.push([
        'content_block_start',
        { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } },
      ])
      events.push([
        'content_block_delta',
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) },
        },
      ])
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }])
  })
  const stop = turn.stop_reason ?? (turn.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn')
  events.push([
    'message_delta',
    { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } },
  ])
  events.push(['message_stop', { type: 'message_stop' }])
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

export interface FakeRequest {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

/**
 * An Anthropic client whose fetch answers each request with the next fake turn (or the given
 * Response), and records the requests. No network.
 */
export function fakeClient(turns: (FakeTurn | (() => Response))[]) {
  const requests: FakeRequest[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    requests.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
    })
    const next = turns.shift()
    if (!next) throw new Error('fakeClient: no more turns')
    if (typeof next === 'function') return next()
    return new Response(sseBody(next), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const client = new Anthropic({ apiKey: 'sk-ant-test', fetch, maxRetries: 0 })
  return { client, requests }
}

/** An Anthropic-style JSON error response. */
export const errorResponse = (status: number, type: string, message: string) => () =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
