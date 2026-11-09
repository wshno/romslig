import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import {
  catalogById,
  findFreeSpot,
  furnitureIssues,
  describeFurnitureIssue,
  newId,
  redetectRooms,
  roomAt,
  wallLength,
  type FurnitureItem,
  type Opening,
  type Scenario,
  type Wall,
  DEFAULTS,
  FIXTURE_INFO,
  PROFESSIONALS,
  RUN_INFO,
  describeInstallations,
  installationsInWall,
} from '@romslig/shared'
import { WET_ROOMS, type Workspace } from './workspace.ts'

const json = (v: unknown) => JSON.stringify(v)

/** Problems for a set of furniture ids in a scenario, as readable text. */
function problemsFor(s: Scenario, ids: string[]) {
  const issues = furnitureIssues(s)
  return ids.flatMap((id) => {
    const f = s.furniture.find((x) => x.id === id)
    return f
      ? (issues.get(id) ?? []).map((i) => ({ furniture_id: id, problem: describeFurnitureIssue(i, s, f.catalogId) }))
      : []
  })
}

function requireCatalogId(id: string) {
  if (!catalogById.has(id))
    throw new Error(`Unknown catalog_id "${id}". Use an id from the catalog in the system prompt.`)
}

export function buildTools(ws: Workspace, activity: (text: string) => void) {
  const viewVariant = betaZodTool({
    eager_input_streaming: true,
    name: 'view_variant',
    description:
      'Returns a variant (scenario) as JSON: rooms with polygons and areas, walls (load bearing, exterior, which rooms they separate), openings, furniture with positions and sizes, and every furniture problem (collisions, missing free space, blocked doors). Use it to check your work after changing a variant.',
    inputSchema: z.object({ scenario_id: z.string() }),
    run: async ({ scenario_id }) => json(ws.describe(ws.get(scenario_id))),
  })

  const createVariant = betaZodTool({
    eager_input_streaming: true,
    name: 'create_variant',
    description:
      "Creates a new variant as a copy of the user's current variant (or of base_scenario_id) and returns its scenario_id. Every concrete proposal (furniture layout, wall change) must go into a variant you created; the user's own variants are read-only. Give it a short, descriptive Norwegian name, e.g. «Åpent kjøkken mot stue».",
    inputSchema: z.object({
      name: z.string().describe('Short Norwegian name shown to the user'),
      base_scenario_id: z.string().nullable().describe('Variant to copy; null = the current variant'),
    }),
    run: async ({ name, base_scenario_id }) => {
      const s = ws.createVariant(name, base_scenario_id)
      activity(`Lager variant «${name}»`)
      return json({ scenario_id: s.id, name: s.name })
    },
  })

  const autoPlace = betaZodTool({
    eager_input_streaming: true,
    name: 'auto_place_furniture',
    description:
      'Places catalog items in a room of an editable variant, one after another, each at the first spot with no problems: wall-standing items along the walls facing into the room, tables/rugs/chairs in the open floor. Prefer this over computing coordinates yourself. Items that do not fit are reported back and not placed.',
    inputSchema: z.object({
      scenario_id: z.string(),
      room_id: z.string(),
      catalog_ids: z.array(z.string()).min(1).describe('In priority order: the most important item first'),
    }),
    run: async ({ scenario_id, room_id, catalog_ids }) => {
      let s = ws.editable(scenario_id)
      const room = s.rooms.find((r) => r.id === room_id)
      if (!room) throw new Error(`Unknown room_id "${room_id}" in this variant.`)
      catalog_ids.forEach(requireCatalogId)
      activity(`Møblerer «${room.name}» (${catalog_ids.length} møbler)`)
      const placed: { id: string; catalog_id: string; x: number; y: number; rotation: number }[] = []
      const notPlaced: string[] = []
      for (const catalogId of catalog_ids) {
        const spot = findFreeSpot(s, catalogId, room)
        if (!spot) {
          notPlaced.push(catalogId)
          continue
        }
        const item: FurnitureItem = { id: newId('f_'), catalogId, ...spot, roomId: room.id, size: null, label: null }
        s = { ...s, furniture: [...s.furniture, item] }
        placed.push({ id: item.id, catalog_id: catalogId, x: item.x, y: item.y, rotation: Math.round(item.rotation) })
      }
      ws.save(s)
      return json({
        placed,
        not_placed: notPlaced,
        hint: notPlaced.length
          ? 'Items in not_placed did not fit without problems. Consider smaller alternatives, removing something, or place_furniture with explicit coordinates and explain the compromise.'
          : undefined,
      })
    },
  })

  const placeFurniture = betaZodTool({
    eager_input_streaming: true,
    name: 'place_furniture',
    description:
      "Places catalog items at explicit positions in an editable variant. x, y = centre of the footprint in meters (x right, y down); rotation in degrees clockwise, 0 = front faces +y (down in the plan), 90 = front faces -x, 180 = faces -y, 270 = faces +x. Optional size override in cm for the user's own furniture. Returns problems for the new items.",
    inputSchema: z.object({
      scenario_id: z.string(),
      items: z
        .array(
          z.object({
            catalog_id: z.string(),
            x: z.number(),
            y: z.number(),
            rotation: z.number(),
            label: z.string().nullable(),
            size_cm: z
              .object({ w: z.number().positive(), d: z.number().positive(), h: z.number().positive() })
              .nullable(),
          }),
        )
        .min(1),
    }),
    run: async ({ scenario_id, items }) => {
      const s = ws.editable(scenario_id)
      items.forEach((i) => requireCatalogId(i.catalog_id))
      const added: FurnitureItem[] = items.map((i) => ({
        id: newId('f_'),
        catalogId: i.catalog_id,
        x: i.x,
        y: i.y,
        rotation: ((i.rotation % 360) + 360) % 360,
        roomId: roomAt(i, s.rooms)?.id ?? null,
        size: i.size_cm ? { w: i.size_cm.w / 100, d: i.size_cm.d / 100, h: i.size_cm.h / 100 } : null,
        label: i.label,
      }))
      const next = { ...s, furniture: [...s.furniture, ...added] }
      ws.save(next)
      activity(`Plasserer ${added.length} ${added.length === 1 ? 'møbel' : 'møbler'}`)
      return json({
        added: added.map((f) => ({ id: f.id, catalog_id: f.catalogId })),
        problems: problemsFor(
          next,
          added.map((f) => f.id),
        ),
      })
    },
  })

  const updateFurniture = betaZodTool({
    eager_input_streaming: true,
    name: 'update_furniture',
    description:
      'Moves, rotates or removes furniture in an editable variant. Returns remaining problems for the moved items.',
    inputSchema: z.object({
      scenario_id: z.string(),
      changes: z
        .array(
          z.object({
            furniture_id: z.string(),
            x: z.number().nullable(),
            y: z.number().nullable(),
            rotation: z.number().nullable(),
            remove: z.boolean().describe('true removes the item; the other fields are then ignored'),
          }),
        )
        .min(1),
    }),
    run: async ({ scenario_id, changes }) => {
      const s = ws.editable(scenario_id)
      let furniture = s.furniture
      for (const c of changes) {
        if (!furniture.some((f) => f.id === c.furniture_id))
          throw new Error(`Unknown furniture_id "${c.furniture_id}".`)
        if (c.remove) {
          furniture = furniture.filter((f) => f.id !== c.furniture_id)
          continue
        }
        furniture = furniture.map((f) => {
          if (f.id !== c.furniture_id) return f
          const moved = { ...f, x: c.x ?? f.x, y: c.y ?? f.y, rotation: c.rotation ?? f.rotation }
          return { ...moved, roomId: roomAt(moved, s.rooms)?.id ?? null }
        })
      }
      const next = { ...s, furniture }
      ws.save(next)
      activity(`Justerer ${changes.length} ${changes.length === 1 ? 'møbel' : 'møbler'}`)
      return json({
        problems: problemsFor(
          next,
          changes.filter((c) => !c.remove).map((c) => c.furniture_id),
        ),
      })
    },
  })

  const WallChange = z.discriminatedUnion('action', [
    z.object({ action: z.literal('remove_wall'), wall_id: z.string() }),
    z.object({
      action: z.literal('add_wall'),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      thickness: z.number().describe('Meters; typical new partition wall 0.1'),
    }),
    z.object({
      action: z.literal('move_wall'),
      wall_id: z.string(),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
    }),
    z.object({
      action: z.literal('add_opening'),
      wall_id: z.string(),
      kind: z.enum(['door', 'window', 'opening']),
      center_offset: z.number().describe('Distance in meters from the wall start point (a) to the opening centre'),
      width: z.number(),
    }),
    z.object({ action: z.literal('remove_opening'), opening_id: z.string() }),
    z.object({ action: z.literal('resize_opening'), opening_id: z.string(), width: z.number() }),
  ])

  const modifyWalls = betaZodTool({
    eager_input_streaming: true,
    name: 'modify_walls',
    description:
      'Changes walls and openings in an editable variant: remove/add/move walls, add/remove/resize doors, windows and openings. Rooms are re-detected afterwards (existing rooms keep their names). Returns regulatory and structural warnings you MUST pass on to the user (load-bearing walls, wet rooms, exterior walls), the new rooms, and furniture problems caused by the change.',
    inputSchema: z.object({
      scenario_id: z.string(),
      changes: z.array(WallChange).min(1),
    }),
    run: async ({ scenario_id, changes }) => {
      const s = ws.editable(scenario_id)
      const warnings = new Set<string>()
      let walls = s.walls
      let openings = s.openings
      const wallById = (id: string) => {
        const w = walls.find((x) => x.id === id)
        if (!w) throw new Error(`Unknown wall_id "${id}".`)
        return w
      }
      const flagWall = (w: Wall, verb: string) => {
        if (w.loadBearing === 'yes')
          warnings.add(
            `Veggen som ${verb} er markert som bærende: krever prosjektering av rådgivende ingeniør (RIB), og som regel søknad.`,
          )
        else if (w.loadBearing === 'unknown')
          warnings.add(`Det er ukjent om veggen som ${verb} er bærende: må avklares med RIB før arbeid starter.`)
        if (w.exterior)
          warnings.add(
            `Veggen som ${verb} er en yttervegg: krever normalt byggesøknad og samtykke fra sameiet/borettslaget.`,
          )
        const wet = ws
          .roomsBesideWall(s, w)
          .map((id) => s.rooms.find((r) => r.id === id))
          .filter((r) => r && WET_ROOMS.has(r.type))
        if (wet.length)
          warnings.add(
            `Endringen berører våtrom (${wet.map((r) => r!.name).join(', ')}): arbeid må utføres av fagfolk etter TEK17 og våtromsnormen, med dokumentasjon.`,
          )
        const inst = installationsInWall(s, w)
        if (inst.fixtures.length || inst.runs.length) {
          const pros = [
            ...new Set([
              ...inst.fixtures.map((x) => FIXTURE_INFO[x.kind].category),
              ...inst.runs.map((r) => RUN_INFO[r.kind].category),
            ]),
          ]
          warnings.add(
            `Veggen som ${verb} har ${describeInstallations(inst)}: dette må flyttes eller legges om av ${pros.map((c) => PROFESSIONALS[c]).join(' og ')}, og øker kostnaden.`,
          )
        }
      }
      for (const c of changes) {
        switch (c.action) {
          case 'remove_wall': {
            flagWall(wallById(c.wall_id), 'fjernes')
            walls = walls.filter((w) => w.id !== c.wall_id)
            openings = openings.filter((o) => o.wallId !== c.wall_id)
            break
          }
          case 'move_wall': {
            const w = wallById(c.wall_id)
            flagWall(w, 'flyttes')
            walls = walls.map((x) => (x.id === w.id ? { ...x, a: { x: c.x1, y: c.y1 }, b: { x: c.x2, y: c.y2 } } : x))
            break
          }
          case 'add_wall':
            walls = [
              ...walls,
              {
                id: newId('w_'),
                a: { x: c.x1, y: c.y1 },
                b: { x: c.x2, y: c.y2 },
                thickness: c.thickness,
                height: ws.project.ceilingHeight,
                loadBearing: 'no',
                exterior: false,
              },
            ]
            break
          case 'add_opening': {
            const w = wallById(c.wall_id)
            if (c.width > wallLength(w))
              throw new Error(`Opening is wider than wall "${w.id}" (${wallLength(w).toFixed(2)} m).`)
            if (c.kind !== 'door') flagWall(w, 'får en ny åpning')
            else if (w.loadBearing !== 'no') flagWall(w, 'får en ny dør')
            const d = DEFAULTS[c.kind]
            const o: Opening = {
              id: newId('o_'),
              wallId: w.id,
              kind: c.kind,
              offset: c.center_offset,
              width: c.width,
              height: d.height,
              sill: d.sill,
              flip: false,
            }
            openings = [...openings, o]
            break
          }
          case 'remove_opening':
            if (!openings.some((o) => o.id === c.opening_id)) throw new Error(`Unknown opening_id "${c.opening_id}".`)
            openings = openings.filter((o) => o.id !== c.opening_id)
            break
          case 'resize_opening': {
            const o = openings.find((x) => x.id === c.opening_id)
            if (!o) throw new Error(`Unknown opening_id "${c.opening_id}".`)
            if (c.width > o.width) flagWall(wallById(o.wallId), 'får en større åpning')
            openings = openings.map((x) => (x.id === o.id ? { ...x, width: c.width } : x))
            break
          }
        }
      }
      const next = redetectRooms({ ...s, walls, openings })
      ws.save(next)
      activity(`Endrer vegger i «${next.name}» (${changes.length} endring${changes.length === 1 ? '' : 'er'})`)
      const issues = furnitureIssues(next)
      return json({
        warnings: [...warnings],
        rooms_after: next.rooms.map((r) => ({ id: r.id, name: r.name, type: r.type })),
        furniture_problems: next.furniture.flatMap((f) =>
          (issues.get(f.id) ?? []).map((i) => ({
            furniture_id: f.id,
            problem: describeFurnitureIssue(i, next, f.catalogId),
          })),
        ),
      })
    },
  })

  const addNote = betaZodTool({
    eager_input_streaming: true,
    name: 'add_note',
    description:
      'Saves a short note the user can find later, e.g. material and colour suggestions, priorities or rough cost estimates for a room. Attach it to a variant you created (scenario_id) or leave scenario_id null to attach it to the current variant.',
    inputSchema: z.object({
      scenario_id: z.string().nullable(),
      room_id: z.string().nullable(),
      text: z.string(),
    }),
    run: async ({ scenario_id, room_id, text }) => {
      ws.addNote(scenario_id, room_id, text)
      activity('Lagrer notat')
      return json({ ok: true })
    },
  })

  return [viewVariant, createVariant, autoPlace, placeFurniture, updateFurniture, modifyWalls, addNote]
}
