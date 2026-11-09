import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { AiError, explainAiError } from './client.ts'
import { errorResponse, fakeClient } from './testing.ts'

async function errorFrom(status: number, type: string) {
  const { client } = fakeClient([errorResponse(status, type, 'nope')])
  try {
    await client.messages.create({ model: 'claude-opus-5-5', max_tokens: 10, messages: [] })
  } catch (e) {
    return explainAiError(e)
  }
  throw new Error('expected an error')
}

describe('explainAiError', () => {
  it('maps a rejected key to the Norwegian key message', async () => {
    const e = await errorFrom(401, 'authentication_error')
    expect(e).toBeInstanceOf(AiError)
    expect(e.message).toMatch(/^Anthropic-nøkkelen ble avvist/)
    expect((e as AiError).kind).toBe('auth')
  })

  it('maps rate limits and overload', async () => {
    expect((await errorFrom(429, 'rate_limit_error')).message).toMatch(/For mange forespørsler/)
    expect((await errorFrom(529, 'overloaded_error')).message).toMatch(/overbelastet/)
  })

  it('keeps other API errors with their status', async () => {
    expect((await errorFrom(400, 'invalid_request_error')).message).toBe('Claude-feil (400): nope')
  })

  it('passes AiErrors through and explains bad JSON', () => {
    const own = new AiError('x', 'refusal')
    expect(explainAiError(own)).toBe(own)
    expect(explainAiError(new SyntaxError('bad')).message).toBe('Claude returnerte ikke gyldig JSON.')
    expect(explainAiError(new Anthropic.APIConnectionError({ message: 'down' })).message).toMatch(/kontakt med Claude/)
  })
})
