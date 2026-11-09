import { useEffect, useState } from "react";
import type { ProjectSummary } from "@romslig/shared";
import { api } from "../api.ts";

export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.list().then(setProjects).catch((e) => setError(e.message));
  useEffect(() => void refresh(), []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api.create(name || "Min leilighet", file);
      window.location.hash = `#/p/${p.id}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <header>
        <h1>Romslig</h1>
        <p>Planlegg renoveringen av leiligheten din. Last opp plantegningen, digitaliser den til 3D og bruk modellen som arbeidsflate.</p>
      </header>

      <form className="card new-project" onSubmit={create}>
        <h2>Nytt prosjekt</h2>
        <label>
          Navn
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Min leilighet" />
        </label>
        <label>
          Plantegning (JPG/PNG)
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Oppretter…" : "Opprett prosjekt"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>

      <section className="card">
        <h2>Prosjekter</h2>
        {projects === null ? (
          <p className="muted">Laster…</p>
        ) : projects.length === 0 ? (
          <p className="muted">Ingen prosjekter ennå.</p>
        ) : (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id}>
                <a href={`#/p/${p.id}`}>{p.name}</a>
                <span className="muted">{new Date(p.updatedAt).toLocaleString("nb-NO")}</span>
                <button
                  className="link danger"
                  onClick={async () => {
                    if (!confirm(`Slette «${p.name}»?`)) return;
                    await api.remove(p.id);
                    refresh();
                  }}
                >
                  Slett
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
