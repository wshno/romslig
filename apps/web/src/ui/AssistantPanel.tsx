import { useEffect, useRef, useState, type ReactNode } from 'react'
import { newId, type ChatMessage, type Note } from '@romslig/shared'
import { api, askAssistant } from '../api.ts'
import { activeScenario, useStore } from '../store.ts'

const SUGGESTIONS = [
  'Foreslå en god møblering av stua',
  'Kan vi åpne kjøkkenet mot stua? Hva må vi tenke på?',
  'Hvordan kan vi få mer lagringsplass?',
  'Hvilke rom bør vi prioritere å pusse opp først?',
]

interface Pending {
  question: ChatMessage
  text: string
  activity: { id: string; text: string }[]
  thinking: string
  error: string | null
}

export function AssistantPanel() {
  const project = useStore((s) => s.project)!
  const selection = useStore((s) => s.selection)
  const scenario = activeScenario(project)
  const [roomId, setRoomId] = useState<string | null>(selection?.kind === 'room' ? selection.id : null)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .health()
      .then((h) => setAiAvailable(h.ai))
      .catch(() => setAiAvailable(false))
  }, [])

  // Keep the newest message in view
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [project.chat.length, pending?.text, pending?.activity.length])

  // Stop a running request when the panel closes
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || pending) return
    const question: ChatMessage = {
      id: newId('m_'),
      role: 'user',
      text: message,
      createdAt: new Date().toISOString(),
      roomId,
      scenarioIds: [],
    }
    const baseScenarioId = project.activeScenarioId
    const abort = new AbortController()
    abortRef.current = abort
    setInput('')
    setPending({ question, text: '', activity: [], thinking: '', error: null })
    try {
      for await (const ev of askAssistant(project, roomId, message, abort.signal)) {
        if (ev.type === 'text') setPending((p) => p && { ...p, text: p.text + ev.delta })
        else if (ev.type === 'thinking') setPending((p) => p && { ...p, thinking: p.thinking + ev.delta })
        else if (ev.type === 'activity')
          setPending((p) => p && { ...p, activity: [...p.activity, { id: newId('a_'), text: ev.text }] })
        else if (ev.type === 'error') setPending((p) => p && { ...p, error: ev.message })
        else if (ev.type === 'done') {
          useStore.getState().applyAssistantResult({
            question,
            answer: {
              id: newId('m_'),
              role: 'assistant',
              text: ev.text,
              createdAt: new Date().toISOString(),
              roomId,
              scenarioIds: ev.scenarios.map((s) => s.id),
            },
            scenarios: ev.scenarios,
            notes: ev.notes,
            baseScenarioId,
          })
          setPending(null)
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) setPending((p) => p && { ...p, error: (e as Error).message })
      else setPending(null)
    } finally {
      abortRef.current = null
    }
  }

  return (
    <div className="assistant">
      <div className="assistant-head">
        <label className="field">
          <span>Spør om</span>
          <select value={roomId ?? ''} onChange={(e) => setRoomId(e.target.value || null)}>
            <option value="">Hele leiligheten</option>
            {scenario.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="assistant-messages" ref={listRef}>
        {aiAvailable === false && (
          <p className="note">AI er ikke tilgjengelig: legg ANTHROPIC_API_KEY i .env og start serveren på nytt.</p>
        )}
        {project.chat.length === 0 && !pending && (
          <div className="assistant-empty">
            <p className="muted">
              Still spørsmål om leiligheten, eller be om forslag. Konkrete forslag lages som egne varianter, så
              originalen din aldri endres.
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion-chip" onClick={() => void send(s)} disabled={!aiAvailable}>
                {s}
              </button>
            ))}
          </div>
        )}
        {project.chat.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {pending && (
          <>
            <Message message={pending.question} />
            <div className="msg assistant-msg">
              {pending.activity.length > 0 && (
                <ul className="activity">
                  {pending.activity.map((a) => (
                    <li key={a.id}>{a.text}</li>
                  ))}
                </ul>
              )}
              {!pending.text && !pending.error && <Thinking text={pending.thinking} />}
              {pending.text && <Markdown text={pending.text} />}
              {pending.error && (
                <p className="error">
                  {pending.error}{' '}
                  <button className="link" onClick={() => setPending(null)}>
                    Lukk
                  </button>
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <form
        className="assistant-input"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <textarea
          value={input}
          rows={3}
          placeholder={
            aiAvailable === false ? 'AI er ikke satt opp' : 'Spør assistenten… (Enter sender, Shift+Enter ny linje)'
          }
          disabled={!aiAvailable}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
        />
        {pending && !pending.error ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            Avbryt
          </button>
        ) : (
          <button className="primary" disabled={!input.trim() || !aiAvailable}>
            Send
          </button>
        )}
      </form>
    </div>
  )
}

function Message({ message }: { message: ChatMessage }) {
  const project = useStore((s) => s.project)!
  const setActive = useStore((s) => s.setActiveScenario)
  const room = message.roomId ? activeScenario(project).rooms.find((r) => r.id === message.roomId) : undefined
  if (message.role === 'user')
    return (
      <div className="msg user-msg">
        {room && <span className="msg-focus">{room.name}</span>}
        {message.text}
      </div>
    )
  const variants = message.scenarioIds.flatMap((id) => project.scenarios.filter((s) => s.id === id))
  return (
    <div className="msg assistant-msg">
      <Markdown text={message.text} />
      {variants.length > 0 && (
        <div className="variant-links">
          {variants.map((v) => (
            <button
              key={v.id}
              className={project.activeScenarioId === v.id ? 'active' : ''}
              onClick={() => setActive(v.id)}
              title="Bytt til denne varianten"
            >
              {project.activeScenarioId === v.id ? '● ' : 'Vis '}«{v.name}»
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** While the assistant reasons: the tail of its summarised thinking, so the user sees progress. */
function Thinking({ text }: { text: string }) {
  const tail = text.length > 280 ? '…' + text.slice(-280) : text
  return (
    <div className="thinking">
      <span className="thinking-label">Tenker…</span>
      {tail && <p>{tail}</p>}
    </div>
  )
}

/** Inline **bold** and `code` (no HTML is interpreted). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    const key = `${i}:${part}`
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>
    return part
  })
}

/** A small, safe Markdown subset: headings, bullet and numbered lists, paragraphs, bold. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const seen = new Map<string, number>()
    const items = list.items.map((it) => {
      const n = (seen.get(it) ?? 0) + 1
      seen.set(it, n)
      return <li key={`${it}#${n}`}>{inline(it)}</li>
    })
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const bullet = /^[-*•]\s(.*)/.exec(line)
    const numbered = /^\d+[.)]\s(.*)/.exec(line)
    const heading = /^#{1,4}\s(.*)/.exec(line)
    if (bullet || numbered) {
      const ordered = Boolean(numbered)
      if (list && list.ordered !== ordered) flush()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1]!.trim())
      continue
    }
    flush()
    if (heading) blocks.push(<h5 key={blocks.length}>{inline(heading[1]!.trim())}</h5>)
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>)
  }
  flush()
  return <div className="md">{blocks}</div>
}

/** Notes (mostly from the assistant) for the active variant, optionally only one room's. */
export function NotesList({ roomId }: { roomId?: string }) {
  const project = useStore((s) => s.project)!
  const scenario = activeScenario(project)
  const deleteNote = useStore((s) => s.deleteNote)
  const notes = scenario.notes.filter((n: Note) => roomId === undefined || n.roomId === roomId)
  if (!notes.length) return null
  return (
    <ul className="notes">
      {notes.map((n) => {
        const room = scenario.rooms.find((r) => r.id === n.roomId)
        return (
          <li key={n.id}>
            <div className="note-meta">
              {n.author === 'ai' ? 'Assistent' : 'Deg'}
              {room && roomId === undefined ? ` · ${room.name}` : ''}
              <button className="link danger" onClick={() => deleteNote(scenario.id, n.id)} title="Slett notat">
                ✕
              </button>
            </div>
            <Markdown text={n.text} />
          </li>
        )
      })}
    </ul>
  )
}
