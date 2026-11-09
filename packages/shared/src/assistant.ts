import type { Note, Scenario } from './model.ts'

/** Server-sent events from the assistant endpoint, one JSON object per SSE message. */
export type AssistantEvent =
  /** A piece of the answer text. */
  | { type: 'text'; delta: string }
  /** A piece of the summarised reasoning, shown while the assistant works. */
  | { type: 'thinking'; delta: string }
  /** What the assistant is doing right now, e.g. "Lager variant «Åpent kjøkken»". */
  | { type: 'activity'; text: string }
  /**
   * The finished answer. `scenarios` are new variants to add to the project; `notes` belong to the
   * variant the question was asked from.
   */
  | { type: 'done'; text: string; scenarios: Scenario[]; notes: Note[] }
  | { type: 'error'; message: string }
