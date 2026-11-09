import type { DigitizeSuggestion, Project, ProjectSummary } from "@romslig/shared";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  health: () => req<{ ok: boolean; ai: boolean }>("/api/health"),
  list: () => req<ProjectSummary[]>("/api/projects"),
  get: (id: string) => req<Project>(`/api/projects/${id}`),
  create: (name: string, image: File | null) => {
    const fd = new FormData();
    fd.set("name", name);
    if (image) fd.set("image", image);
    return req<Project>("/api/projects", { method: "POST", body: fd });
  },
  save: (p: Project) =>
    req<Project>(`/api/projects/${p.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }),
  remove: (id: string) => req<void>(`/api/projects/${id}`, { method: "DELETE" }),
  planUrl: (id: string) => `/api/projects/${id}/plan`,
  digitize: (id: string) => req<DigitizeSuggestion>(`/api/projects/${id}/digitize`, { method: "POST" }),
};
