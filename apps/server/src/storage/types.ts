import type { Project, ProjectSummary } from '@romslig/shared'

/**
 * Where projects and plan images live. Every call is scoped to an owner (the user id); a
 * project owned by someone else behaves exactly like one that does not exist.
 */
export interface ProjectStore {
  list(owner: string): Promise<ProjectSummary[]>
  /** Throws 404 if missing or owned by someone else. */
  get(owner: string, id: string): Promise<Project>
  /** Stores a new project (version 1) and its plan image, if any. */
  create(owner: string, project: Project, planPng: Uint8Array | null): Promise<Project>
  /**
   * Replaces a project if its stored version equals expectedVersion; returns it with the version
   * incremented. Throws 409 if someone saved in between, 404 if missing.
   */
  update(owner: string, project: Project, expectedVersion: number): Promise<Project>
  delete(owner: string, id: string): Promise<void>
  getPlan(owner: string, id: string): Promise<Uint8Array>
  close?(): Promise<void>
}
