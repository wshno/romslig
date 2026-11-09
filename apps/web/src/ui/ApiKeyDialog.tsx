import { useEffect, useState } from 'react'
import { AiError, explainAiError } from '@romslig/ai'
import { byokClient, useAi } from '../ai/client.ts'

type Status = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok' } | { kind: 'error'; message: string }

/**
 * The user's own Anthropic key (byok mode). The key is kept in sessionStorage only: it goes from
 * this browser straight to Anthropic, never to our API or into the project, and is forgotten when
 * the tab closes.
 */
export function ApiKeyDialog() {
  const { hasKey, setKey, forgetKey, closeKeyDialog } = useAi()
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeKeyDialog()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeKeyDialog])

  const save = async () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    setStatus({ kind: 'testing' })
    try {
      // A cheap call that only succeeds with a valid key
      await byokClient(trimmed).models.list({ limit: 1 })
    } catch (e) {
      const err = explainAiError(e)
      if (err instanceof AiError && err.kind === 'auth') {
        setStatus({ kind: 'error', message: err.message })
        return
      }
      // Could not test it (network, overload…): keep it, but say so
      if (!setKey(trimmed)) setStatus({ kind: 'error', message: 'Nettleseren tillot ikke å lagre nøkkelen i økten.' })
      else setStatus({ kind: 'error', message: `Nøkkelen er lagret, men kunne ikke testes: ${err.message}` })
      setDraft('')
      return
    }
    if (!setKey(trimmed)) {
      setStatus({ kind: 'error', message: 'Nettleseren tillot ikke å lagre nøkkelen i økten.' })
      return
    }
    setDraft('')
    setStatus({ kind: 'ok' })
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && closeKeyDialog()}>
      <div className="modal api-key-dialog" role="dialog" aria-modal="true" aria-labelledby="api-key-title">
        <h3 id="api-key-title">🔑 Anthropic-nøkkel</h3>
        <p>
          AI-funksjonene (digitalisering, bildegjenkjenning og assistenten) bruker Claude med din egen API-nøkkel.
          Bruken faktureres din Anthropic-konto. Lag en nøkkel på{' '}
          <a href="https://platform.claude.com" target="_blank" rel="noreferrer noopener">
            platform.claude.com
          </a>
          .
        </p>
        <ul className="muted api-key-facts">
          <li>Nøkkelen sendes bare fra nettleseren din direkte til Anthropic, aldri til Romslig-serveren.</li>
          <li>Den lagres bare i denne fanen og glemmes når fanen lukkes. Den lagres aldri i prosjektet.</li>
        </ul>
        <form
          className="api-key-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={hasKey ? 'En nøkkel er lagt inn. Lim inn en ny for å bytte.' : 'sk-ant-…'}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (status.kind !== 'testing') setStatus({ kind: 'idle' })
            }}
            aria-label="Anthropic API-nøkkel"
            autoFocus
          />
          <button className="primary" disabled={!draft.trim() || status.kind === 'testing'}>
            {status.kind === 'testing' ? 'Tester…' : 'Lagre og test'}
          </button>
        </form>
        {status.kind === 'ok' && <p className="ok">✓ Nøkkelen fungerer.</p>}
        {status.kind === 'error' && <p className="error">{status.message}</p>}
        <div className="row spread">
          <button
            className="link danger"
            disabled={!hasKey}
            onClick={() => {
              forgetKey()
              setStatus({ kind: 'idle' })
            }}
          >
            Glem nøkkelen
          </button>
          <button onClick={closeKeyDialog}>{status.kind === 'ok' ? 'Ferdig' : 'Lukk'}</button>
        </div>
      </div>
    </div>
  )
}

/** TopBar button (byok only): shows whether a key is set and opens the dialog. */
export function ApiKeyButton() {
  const mode = useAi((s) => s.config?.aiMode)
  const hasKey = useAi((s) => s.hasKey)
  const open = useAi((s) => s.openKeyDialog)
  if (mode !== 'byok') return null
  return (
    <button
      className={`api-key-button${hasKey ? ' set' : ''}`}
      onClick={open}
      title={hasKey ? 'Anthropic-nøkkel lagt inn for denne fanen' : 'Legg inn Anthropic-nøkkel for AI'}
    >
      🔑 Nøkkel{hasKey ? ' ✓' : ''}
    </button>
  )
}
