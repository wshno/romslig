import Anthropic from '@anthropic-ai/sdk'

/** The model every AI feature uses. The server-mode proxy only allows the models in AI_MODELS. */
export const MODEL = 'claude-opus-5-5'

/** An AI failure with a message that can be shown to the user as is (Norwegian). */
export class AiError extends Error {
  constructor(
    message: string,
    /** What went wrong, so the UI can react (e.g. open the key dialog on 'auth'). */
    readonly kind: 'auth' | 'rate_limit' | 'refusal' | 'truncated' | 'invalid' | 'api' | 'network' = 'api',
  ) {
    super(message)
    this.name = 'AiError'
  }
}

/** Maps SDK and parsing errors to Norwegian messages. Works in the browser and on the server. */
export function explainAiError(e: unknown): Error {
  if (e instanceof AiError) return e
  if (e instanceof Anthropic.AuthenticationError)
    return new AiError('Anthropic-nøkkelen ble avvist. Sjekk at den er riktig og fortsatt aktiv.', 'auth')
  if (e instanceof Anthropic.PermissionDeniedError)
    return new AiError('Anthropic-nøkkelen har ikke tilgang til denne modellen eller funksjonen.', 'auth')
  if (e instanceof Anthropic.RateLimitError)
    return new AiError('For mange forespørsler mot Claude akkurat nå. Prøv igjen om litt.', 'rate_limit')
  if (e instanceof Anthropic.APIConnectionTimeoutError)
    return new AiError('Claude svarte ikke i tide. Prøv igjen.', 'network')
  if (e instanceof Anthropic.APIConnectionError)
    return new AiError('Fikk ikke kontakt med Claude. Sjekk nettforbindelsen.', 'network')
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529) return new AiError('Claude er overbelastet akkurat nå. Prøv igjen om litt.', 'rate_limit')
    // Prefer the API's own message over the SDK's "<status> <whole JSON body>"
    const inner = (e.error as { error?: { message?: unknown } } | undefined)?.error?.message
    return new AiError(`Claude-feil (${e.status ?? '?'}): ${typeof inner === 'string' ? inner : e.message}`, 'api')
  }
  if (e instanceof Anthropic.AnthropicError) return new AiError(`Claude-oppsett: ${e.message}`, 'api')
  if (e instanceof SyntaxError) return new AiError('Claude returnerte ikke gyldig JSON.', 'invalid')
  return e instanceof Error ? e : new Error(String(e))
}

/** The text of a message's text blocks. */
export function messageText(msg: { content: { type: string; text?: string }[] }): string {
  return msg.content.flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join('')
}
