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

/** One piece of furniture recognised in photos of a room. */
export interface RecognizedItem {
  catalogId: string
  /** What the item actually is, e.g. "Grå 3-seter sofa". */
  name: string
  /** Estimated real size (m). */
  size: { w: number; d: number; h: number }
  /** Plan side of the wall it stands against, or free-standing. */
  side: 'top' | 'right' | 'bottom' | 'left' | 'free'
  positionHint: string
  confidence: 'high' | 'medium' | 'low'
  /** 1-based index of the photo it is most visible in. */
  photo: number
}

export interface RecognizeResult {
  roomId: string
  items: RecognizedItem[]
  notes: string
}
