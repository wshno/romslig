import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, type ProjectSummary } from "@romslig/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.ROMSLIG_DATA_DIR ?? path.resolve(here, "../../../data/projects");

const safeId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new HttpError(400, "Ugyldig prosjekt-id");
  return id;
};

export class HttpError extends Error {
  constructor(
    public status: 400 | 404 | 422 | 500 | 502,
    message: string,
  ) {
    super(message);
  }
}

export const projectDir = (id: string) => path.join(DATA_DIR, safeId(id));

export async function listProjects(): Promise<ProjectSummary[]> {
  await mkdir(DATA_DIR, { recursive: true });
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  const out: ProjectSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const p = await loadProject(e.name);
      out.push({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt });
    } catch {
      // skip broken project folders
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<Project> {
  let raw: string;
  try {
    raw = await readFile(path.join(projectDir(id), "project.json"), "utf8");
  } catch {
    throw new HttpError(404, "Fant ikke prosjektet");
  }
  return Project.parse(JSON.parse(raw));
}

export async function saveProject(p: Project): Promise<Project> {
  const dir = projectDir(p.id);
  await mkdir(dir, { recursive: true });
  const next = { ...p, updatedAt: new Date().toISOString() };
  await writeFile(path.join(dir, "project.json"), JSON.stringify(next, null, 2));
  return next;
}

export async function deleteProject(id: string) {
  await rm(projectDir(id), { recursive: true, force: true });
}
