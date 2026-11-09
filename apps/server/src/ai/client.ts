import Anthropic from '@anthropic-ai/sdk'
import { HttpError } from '../errors.ts'

export const MODEL = process.env.ROMSLIG_MODEL ?? 'claude-opus-5-5'

let client: Anthropic | null = null
export function anthropic(): Anthropic {
  if (!client) {
    try {
      client = new Anthropic()
    } catch {
      throw new HttpError(
        400,
        'Mangler Anthropic-nøkkel. Legg ANTHROPIC_API_KEY i .env i prosjektroten og start serveren på nytt.',
      )
    }
  }
  return client
}

export function explainApiError(e: unknown): Error {
  if (e instanceof HttpError) return e
  if (e instanceof Anthropic.AuthenticationError)
    return new HttpError(400, 'Anthropic-nøkkelen ble avvist. Sjekk ANTHROPIC_API_KEY.')
  if (e instanceof Anthropic.RateLimitError)
    return new HttpError(502, 'For mange forespørsler mot Claude akkurat nå. Prøv igjen om litt.')
  if (e instanceof Anthropic.APIError) return new HttpError(502, `Claude-feil (${e.status ?? '?'}): ${e.message}`)
  if (e instanceof Anthropic.AnthropicError && /authentication/i.test(e.message))
    return new HttpError(
      400,
      'Mangler Anthropic-nøkkel. Legg ANTHROPIC_API_KEY=... i en .env-fil i prosjektroten og start serveren på nytt.',
    )
  if (e instanceof Anthropic.AnthropicError) return new HttpError(400, `Claude-oppsett: ${e.message}`)
  if (e instanceof SyntaxError) return new HttpError(502, 'Claude returnerte ikke gyldig JSON.')
  return e instanceof Error ? e : new Error(String(e))
}
