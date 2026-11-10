import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@romslig/shared'
import { api } from '../api.ts'

const listFailed = (e: unknown) => `Kunne ikke hente prosjektene: ${(e as Error).message}`

export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** What went wrong with the list or with an action on one of its projects. */
  const [listError, setListError] = useState<string | null>(null)
  /** The project an action is running on; its buttons wait meanwhile. */
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    api
      .list()
      .then(setProjects)
      .catch((e) => setListError(listFailed(e)))
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const p = await api.create(name || 'Min leilighet', file)
      window.location.hash = `#/p/${p.id}`
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Runs an action on a project in the list and says so in the list if it fails. */
  const act = async (p: ProjectSummary, what: string, action: () => Promise<unknown>) => {
    setBusyId(p.id)
    setListError(null)
    let ok = true
    try {
      await action()
    } catch (err) {
      ok = false
      setListError(`Kunne ikke ${what} «${p.name}»: ${(err as Error).message}`)
    }
    // Also after a failure, so the list shows what is actually stored. A failure to fetch the
    // list then must not replace the message about the action.
    await api.list().then(setProjects, (e) => ok && setListError(listFailed(e)))
    setBusyId(null)
    return ok
  }

  const rename = async (e: React.FormEvent, p: ProjectSummary) => {
    e.preventDefault()
    const next = renaming?.name.trim() ?? ''
    if (!next) return
    if (next === p.name || (await act(p, 'gi nytt navn til', () => api.rename(p.id, next)))) setRenaming(null)
  }

  return (
    <div className="home">
      <header>
        <h1>Romslig</h1>
        <p>
          Planlegg renoveringen av leiligheten din. Last opp plantegningen, digitaliser den til 3D og bruk modellen som
          arbeidsflate.
        </p>
      </header>

      <form className="card new-project" onSubmit={create}>
        <h2>Nytt prosjekt</h2>
        <label>
          Navn
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Min leilighet" />
        </label>
        <label>
          Plantegning (JPG/PNG)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? 'Oppretter…' : 'Opprett prosjekt'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>

      <section className="card">
        <h2>Prosjekter</h2>
        {listError && (
          <p className="error" role="alert">
            {listError}
          </p>
        )}
        {projects === null && !listError && <p className="muted">Laster…</p>}
        {projects?.length === 0 && <p className="muted">Ingen prosjekter ennå.</p>}
        {projects && projects.length > 0 && (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id}>
                {/* The name next to it is the link people and screen readers use */}
                <a className="thumb" href={`#/p/${p.id}`} tabIndex={-1} aria-hidden="true">
                  <img src={api.thumbnailUrl(p)} alt="" loading="lazy" />
                </a>
                {renaming?.id === p.id ? (
                  <form className="rename" onSubmit={(e) => void rename(e, p)}>
                    <input
                      autoFocus
                      aria-label="Nytt navn"
                      maxLength={200}
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                    />
                    <button className="primary" disabled={busyId === p.id || !renaming.name.trim()}>
                      Lagre
                    </button>
                    <button type="button" onClick={() => setRenaming(null)}>
                      Avbryt
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="project-info">
                      <a href={`#/p/${p.id}`}>{p.name}</a>
                      <span className="muted">{new Date(p.updatedAt).toLocaleString('nb-NO')}</span>
                    </div>
                    <button
                      className="link"
                      disabled={busyId === p.id}
                      onClick={() => setRenaming({ id: p.id, name: p.name })}
                    >
                      Gi nytt navn
                    </button>
                    <button
                      className="link"
                      disabled={busyId === p.id}
                      onClick={() => void act(p, 'kopiere', () => api.copy(p.id))}
                    >
                      Kopier
                    </button>
                    <button
                      className="link danger"
                      disabled={busyId === p.id}
                      onClick={() => {
                        if (confirm(`Slette «${p.name}»?`)) void act(p, 'slette', () => api.remove(p.id))
                      }}
                    >
                      Slett
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
