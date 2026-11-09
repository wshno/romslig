import Anthropic from '@anthropic-ai/sdk'
import { create } from 'zustand'
import { AiError, explainAiError } from '@romslig/ai'

export type AiMode = 'byok' | 'server'

export interface AppConfig {
  aiMode: AiMode
  user: { id: string; email: string | null; name: string | null; groups: string[] }
}

/** Where the user's own Anthropic key lives: this tab's session only, never localStorage. */
const KEY_STORAGE = 'romslig.anthropicKey'

function readKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_STORAGE)
  } catch {
    return null
  }
}

/** Thrown when an AI action needs the user's own key and none is set (byok). */
export class MissingKeyError extends Error {
  constructor() {
    super('Legg inn Anthropic-nøkkelen din for å bruke AI.')
    this.name = 'MissingKeyError'
  }
}

interface AiState {
  config: AppConfig | null
  /** Whether a key is stored for this tab (the key itself stays in sessionStorage). */
  hasKey: boolean
  keyDialogOpen: boolean
  openKeyDialog(): void
  closeKeyDialog(): void
  /** Stores the key for this tab. Returns false if the browser refused (e.g. storage blocked). */
  setKey(key: string): boolean
  forgetKey(): void
}

export const useAi = create<AiState>((set) => ({
  config: null,
  hasKey: Boolean(readKey()),
  keyDialogOpen: false,
  openKeyDialog: () => set({ keyDialogOpen: true }),
  closeKeyDialog: () => set({ keyDialogOpen: false }),
  setKey: (key) => {
    try {
      sessionStorage.setItem(KEY_STORAGE, key)
      set({ hasKey: true })
      return true
    } catch {
      return false
    }
  },
  forgetKey: () => {
    try {
      sessionStorage.removeItem(KEY_STORAGE)
    } catch {
      /* nothing stored */
    }
    set({ hasKey: false })
  },
}))

let configPromise: Promise<AppConfig> | null = null

/** GET /api/config, once per page load. */
export function loadConfig(): Promise<AppConfig> {
  configPromise ??= fetch('/api/config')
    .then(async (res) => {
      if (!res.ok) throw new Error(`Kunne ikke hente oppsettet (${res.status}).`)
      const config = (await res.json()) as AppConfig
      useAi.setState({ config })
      return config
    })
    .catch((e: unknown) => {
      configPromise = null // try again next time
      throw e
    })
  return configPromise
}

/** AI is usable: always in server mode, once a key is set in byok mode. Null while loading. */
export function useAiAvailable(): boolean | null {
  const config = useAi((s) => s.config)
  const hasKey = useAi((s) => s.hasKey)
  if (!config) return null
  return config.aiMode === 'server' || hasKey
}

/** An SDK client that goes straight to Anthropic with this key (byok), e.g. to test a key. */
export const byokClient = (apiKey: string) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

/**
 * The SDK client for the current mode. byok: straight from the browser to api.anthropic.com with
 * the user's key. server: through our proxy, which swaps the placeholder for the server's key.
 */
export async function getClient(): Promise<Anthropic> {
  const config = await loadConfig()
  if (config.aiMode === 'server')
    return new Anthropic({
      baseURL: `${location.origin}/api/ai`,
      apiKey: 'server-proxy',
      dangerouslyAllowBrowser: true,
    })
  const key = readKey()
  if (!key) throw new MissingKeyError()
  return byokClient(key)
}

/**
 * Runs an AI action with the right client. Without a key in byok mode (or when Anthropic rejects
 * it), opens the key dialog and returns null instead of failing. Other errors are thrown in
 * Norwegian.
 */
export async function withAi<T>(action: (client: Anthropic) => Promise<T>): Promise<T | null> {
  let client: Anthropic
  try {
    client = await getClient()
  } catch (e) {
    if (e instanceof MissingKeyError) {
      useAi.getState().openKeyDialog()
      return null
    }
    throw e
  }
  try {
    return await action(client)
  } catch (e) {
    const err = explainAiError(e)
    if (err instanceof AiError && err.kind === 'auth' && useAi.getState().config?.aiMode === 'byok')
      useAi.getState().openKeyDialog()
    throw err
  }
}
