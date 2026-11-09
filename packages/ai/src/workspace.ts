import {
  CATALOG,
  FIXTURE_INFO,
  RUN_INFO,
  add,
  clampOpening,
  describeFurnitureIssue,
  furnitureIssues,
  getCatalogItem,
  itemSize,
  mul,
  newId,
  polygonArea,
  roomAt,
  wallDir,
  wallLength,
  type Note,
  type Project,
  type Scenario,
  type Vec2,
  type Wall,
} from '@romslig/shared'

/** Rooms where wall changes touch wet-room rules (TEK17 / våtromsnormen). */
export const WET_ROOMS = new Set(['bad', 'wc', 'vaskerom'])

const r2 = (n: number) => Math.round(n * 100) / 100
const pt = (p: Vec2) => [r2(p.x), r2(p.y)]

/**
 * The assistant's sandbox for one request: the user's current variant (read-only) plus the
 * variants and notes the assistant creates. Nothing here touches stored data; the client applies
 * the result.
 */
export class Workspace {
  readonly base: Scenario
  readonly drafts = new Map<string, Scenario>()
  readonly baseNotes: Note[] = []

  constructor(readonly project: Project) {
    this.base = project.scenarios.find((s) => s.id === project.activeScenarioId) ?? project.scenarios[0]!
  }

  get(id: string): Scenario {
    const s = this.drafts.get(id) ?? this.project.scenarios.find((x) => x.id === id)
    if (!s) throw new Error(`Unknown scenario_id "${id}". Use the id of the current variant or one you created.`)
    return s
  }

  /** A variant the assistant may change: only ones it created in this conversation turn. */
  editable(id: string): Scenario {
    const s = this.drafts.get(id)
    if (!s)
      throw new Error(
        `Scenario "${id}" is not editable. Never change the user's existing variants; call create_variant first and use the scenario_id it returns.`,
      )
    return s
  }

  save(s: Scenario) {
    this.drafts.set(s.id, s)
  }

  createVariant(name: string, baseId: string | null): Scenario {
    const base = baseId ? this.get(baseId) : this.base
    const copy: Scenario = { ...structuredClone(base), id: newId('sc_'), name, parentId: base.id, notes: [] }
    this.save(copy)
    return copy
  }

  addNote(scenarioId: string | null, roomId: string | null, text: string): Note {
    const note: Note = { id: newId('n_'), roomId, text, author: 'ai', createdAt: new Date().toISOString() }
    if (scenarioId && this.drafts.has(scenarioId)) {
      const s = this.editable(scenarioId)
      this.save({ ...s, notes: [...s.notes, note] })
    } else this.baseNotes.push(note)
    return note
  }

  roomName(s: Scenario, id: string | null): string | null {
    return s.rooms.find((r) => r.id === id)?.name ?? null
  }

  /** Rooms on either side of a wall (sampled just off its midpoint, or a given point on it). */
  roomsBesideWall(s: Scenario, w: Wall, at?: Vec2): string[] {
    const d = wallDir(w)
    const n = { x: -d.y, y: d.x }
    const mid = at ?? add(w.a, mul(d, wallLength(w) / 2))
    const off = w.thickness / 2 + 0.15
    return [add(mid, mul(n, off)), add(mid, mul(n, -off))].flatMap((p) => {
      const r = roomAt(p, s.rooms)
      return r ? [r.id] : []
    })
  }

  /** Compact JSON description of a variant for the model. Coordinates in meters. */
  describe(s: Scenario) {
    const issues = furnitureIssues(s)
    return {
      scenario: { id: s.id, name: s.name, editable: this.drafts.has(s.id) },
      rooms: s.rooms.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        area_m2: r2(polygonArea(r.polygon)),
        stated_area_m2: r.statedArea,
        polygon: r.polygon.map(pt),
      })),
      walls: s.walls.map((w) => ({
        id: w.id,
        a: pt(w.a),
        b: pt(w.b),
        length: r2(wallLength(w)),
        thickness: w.thickness,
        load_bearing: w.loadBearing,
        exterior: w.exterior,
        between_rooms: this.roomsBesideWall(s, w),
      })),
      openings: s.openings.flatMap((o) => {
        const w = s.walls.find((x) => x.id === o.wallId)
        if (!w) return []
        const { start, end } = clampOpening(o, w)
        const centre = add(w.a, mul(wallDir(w), (start + end) / 2))
        return [
          {
            id: o.id,
            wall_id: o.wallId,
            kind: o.kind,
            width: o.width,
            center: pt(centre),
            center_offset_from_wall_a: r2((start + end) / 2),
            connects_rooms: this.roomsBesideWall(s, w, centre),
          },
        ]
      }),
      furniture: s.furniture.map((f) => {
        const cat = getCatalogItem(f.catalogId)
        const size = itemSize(f, cat)
        return {
          id: f.id,
          catalog_id: f.catalogId,
          name: f.label ?? cat.name,
          x: r2(f.x),
          y: r2(f.y),
          rotation: Math.round(f.rotation),
          size_cm: [size.w, size.d, size.h].map((m) => Math.round(m * 100)),
          room_id: f.roomId,
        }
      }),
      problems: s.furniture.flatMap((f) =>
        (issues.get(f.id) ?? []).map((i) => ({
          furniture_id: f.id,
          problem: describeFurnitureIssue(i, s, f.catalogId),
        })),
      ),
      notes: s.notes.map((n) => ({ room_id: n.roomId, text: n.text })),
      installations: {
        fixtures: s.fixtures.map((x) => ({
          id: x.id,
          kind: x.kind,
          name: x.label ?? FIXTURE_INFO[x.kind].name,
          position: pt(x),
          height: r2(x.z),
          wall_id: x.wallId,
          room_id: roomAt(x, s.rooms)?.id ?? null,
          note: x.note,
        })),
        runs: s.runs.map((r) => ({
          id: r.id,
          kind: r.kind,
          name: r.label ?? RUN_INFO[r.kind].name,
          placement: r.placement,
          points: r.points.map(pt),
          height: r2(r.z),
          diameter_mm: Math.round(r.diameter * 1000),
          note: r.note,
        })),
        lowered_ceilings: s.loweredCeilings.map((c) => ({
          id: c.id,
          height: c.height,
          polygon: c.polygon.map(pt),
          label: c.label,
        })),
      },
    }
  }
}

/** The catalog as compact text lines for the system prompt (stable, so it caches). */
export function catalogText(): string {
  const cm = (m: number) => Math.round(m * 100)
  return CATALOG.map((c) => {
    const cl = c.clearance
    const extra = [
      c.elevation ? `mounted ${cm(c.elevation)} cm above floor` : '',
      c.allowInClearance ? 'may stand in other items free space' : '',
      c.collides === false ? 'never collides' : '',
    ]
      .filter(Boolean)
      .join(', ')
    return `${c.id} | ${c.name} | ${c.category} | ${cm(c.w)}×${cm(c.d)}×${cm(c.h)} cm | free space front ${cm(cl.front)}, sides ${cm(cl.sides)}, back ${cm(cl.back)} cm${extra ? ' | ' + extra : ''}`
  }).join('\n')
}
