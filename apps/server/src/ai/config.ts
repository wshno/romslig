import type { User } from '../auth.ts'

export type AiMode = 'byok' | 'server'

export interface AiConfig {
  /** The installation's mode. 'server' only when a server key is configured. */
  mode: AiMode
  /** Server key, used only by the proxy in server mode. Never sent to the browser. */
  apiKey: string | null
  /** If set, only members of this group get the server key; others use their own (byok). */
  group: string | null
  /** Upstream for the proxy (tests point it at a fake). */
  baseUrl: string
  /** Models the proxy forwards. */
  models: string[]
  /** Upper bound for max_tokens in proxied requests. */
  maxTokens: number
  /** Proxied requests per user per minute. */
  ratePerMin: number
}

const positiveInt = (raw: string | undefined, fallback: number, name: string) => {
  if (!raw?.trim()) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`)
  return n
}

function withoutTrailingSlash(url: string) {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end--
  return url.slice(0, end)
}

export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env, warn = console.warn): AiConfig {
  const requested = env.AI_MODE?.trim() || 'byok'
  if (requested !== 'byok' && requested !== 'server') throw new Error(`Unknown AI_MODE "${requested}"`)
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || null
  let mode: AiMode = requested
  if (mode === 'server' && !apiKey) {
    warn('AI_MODE=server, men ANTHROPIC_API_KEY mangler. Bruker byok (brukernes egne nøkler).')
    mode = 'byok'
  }
  return {
    mode,
    apiKey: mode === 'server' ? apiKey : null,
    group: env.AI_GROUP?.trim() || null,
    baseUrl: withoutTrailingSlash(env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com'),
    models: (env.AI_MODELS?.trim() || 'claude-opus-5-5')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    maxTokens: positiveInt(env.AI_MAX_TOKENS, 64000, 'AI_MAX_TOKENS'),
    ratePerMin: positiveInt(env.AI_RATE_PER_MIN, 20, 'AI_RATE_PER_MIN'),
  }
}

/** The mode for one user: server mode applies only to members of AI_GROUP when it is set. */
export function aiModeFor(cfg: AiConfig, user: User): AiMode {
  if (cfg.mode !== 'server') return 'byok'
  if (cfg.group && !user.groups.includes(cfg.group)) return 'byok'
  return 'server'
}
