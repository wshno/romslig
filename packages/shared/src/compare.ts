import { getCatalogItem } from './catalog.ts'
import { furnitureIssues, roomAt } from './furniture.ts'
import { add, dist, mul, polygonArea, wallDir, wallLength } from './geometry.ts'
import type { Opening, Scenario, Wall } from './model.ts'
import { FIXTURE_INFO, PROFESSIONALS, RUN_INFO, describeInstallations, installationsInWall } from './installations.ts'

export interface RoomChange {
  id: string
  name: string
  /** m²; null when the room does not exist in that variant. */
  before: number | null
  after: number | null
}

export interface ScenarioComparison {
  installations: { added: number; removed: number; moved: number }
  walls: { removed: Wall[]; added: Wall[]; moved: Wall[] }
  openings: { removed: Opening[]; added: Opening[]; resized: Opening[] }
  rooms: RoomChange[]
  furniture: { added: string[]; removed: string[]; moved: string[] }
  problems: { before: number; after: number }
  /** Things that need professionals or permission, in Norwegian. */
  flags: string[]
  totalArea: { before: number; after: number }
}

const WET = new Set(['bad', 'wc', 'vaskerom'])
const samePos = (a: Wall, b: Wall) => dist(a.a, b.a) + dist(a.b, b.b) < 0.01
const nameOf = (f: { label: string | null; catalogId: string }) => f.label ?? getCatalogItem(f.catalogId).name

/** Rooms on either side of a wall in a scenario. */
function roomsBeside(s: Scenario, w: Wall) {
  const d = wallDir(w)
  const n = { x: -d.y, y: d.x }
  const mid = add(w.a, mul(d, wallLength(w) / 2))
  const off = w.thickness / 2 + 0.15
  return [add(mid, mul(n, off)), add(mid, mul(n, -off))].flatMap((p) => {
    const r = roomAt(p, s.rooms)
    return r ? [r] : []
  })
}

/** What changes going from variant `a` (before) to variant `b` (after). */
export function compareScenarios(a: Scenario, b: Scenario): ScenarioComparison {
  const bWall = new Map(b.walls.map((w) => [w.id, w]))
  const aWall = new Map(a.walls.map((w) => [w.id, w]))
  const removed = a.walls.filter((w) => !bWall.has(w.id))
  const added = b.walls.filter((w) => !aWall.has(w.id))
  const moved = b.walls.filter((w) => aWall.has(w.id) && !samePos(aWall.get(w.id)!, w))

  const bOpen = new Map(b.openings.map((o) => [o.id, o]))
  const aOpen = new Map(a.openings.map((o) => [o.id, o]))
  const openings = {
    removed: a.openings.filter((o) => !bOpen.has(o.id)),
    added: b.openings.filter((o) => !aOpen.has(o.id)),
    resized: b.openings.filter((o) => aOpen.has(o.id) && Math.abs(aOpen.get(o.id)!.width - o.width) > 0.01),
  }

  const roomIds = [...new Set([...a.rooms.map((r) => r.id), ...b.rooms.map((r) => r.id)])]
  const rooms: RoomChange[] = roomIds
    .map((id) => {
      const ra = a.rooms.find((r) => r.id === id)
      const rb = b.rooms.find((r) => r.id === id)
      return {
        id,
        name: (rb ?? ra)!.name,
        before: ra ? polygonArea(ra.polygon) : null,
        after: rb ? polygonArea(rb.polygon) : null,
      }
    })
    .filter((r) => r.before === null || r.after === null || Math.abs(r.before - r.after) > 0.05)

  const aFurn = new Map(a.furniture.map((f) => [f.id, f]))
  const bFurn = new Map(b.furniture.map((f) => [f.id, f]))
  const furniture = {
    added: b.furniture.filter((f) => !aFurn.has(f.id)).map(nameOf),
    removed: a.furniture.filter((f) => !bFurn.has(f.id)).map(nameOf),
    moved: b.furniture
      .filter((f) => {
        const before = aFurn.get(f.id)
        return before && (dist(before, f) > 0.05 || Math.abs(before.rotation - f.rotation) > 1)
      })
      .map(nameOf),
  }

  const flags = new Set<string>()
  for (const w of [...removed, ...moved.map((m) => aWall.get(m.id)!)]) {
    if (w.loadBearing === 'yes')
      flags.add('En bærende vegg er fjernet eller flyttet: krever prosjektering av RIB og normalt søknad.')
    else if (w.loadBearing === 'unknown')
      flags.add('Det er ukjent om en fjernet eller flyttet vegg er bærende: må avklares med RIB.')
    if (w.exterior) flags.add('Yttervegg er endret: krever normalt byggesøknad og samtykke fra sameiet/borettslaget.')
    const inst = installationsInWall(a, w)
    if (inst.fixtures.length || inst.runs.length) {
      const pros = [
        ...new Set([
          ...inst.fixtures.map((x) => FIXTURE_INFO[x.kind].category),
          ...inst.runs.map((r) => RUN_INFO[r.kind].category),
        ]),
      ]
      flags.add(
        `En fjernet eller flyttet vegg har ${describeInstallations(inst)}: må flyttes av ${pros.map((c) => PROFESSIONALS[c]).join(' og ')}.`,
      )
    }
  }
  for (const w of [...removed, ...added, ...moved]) {
    const wet = [...roomsBeside(a, w), ...roomsBeside(b, w)].filter((r) => WET.has(r.type))
    if (wet.length)
      flags.add(
        `Våtrom berøres (${[...new Set(wet.map((r) => r.name))].join(', ')}): fagfolk etter TEK17 og våtromsnormen.`,
      )
  }
  for (const o of openings.added) {
    const w = bWall.get(o.wallId)
    if (w && o.kind !== 'door' && w.exterior)
      flags.add('Nytt vindu i yttervegg: krever normalt søknad og samtykke fra sameiet/borettslaget.')
    if (w && w.loadBearing !== 'no')
      flags.add('Ny åpning i en vegg som er eller kan være bærende: krever vurdering av RIB.')
  }

  const totalArea = (s: Scenario) => s.rooms.reduce((sum, r) => sum + polygonArea(r.polygon), 0)
  return {
    walls: { removed, added, moved },
    openings,
    rooms,
    furniture,
    problems: { before: furnitureIssues(a).size, after: furnitureIssues(b).size },
    installations: installationChanges(a, b),
    flags: [...flags],
    totalArea: { before: totalArea(a), after: totalArea(b) },
  }
}

/** Counts of fixtures, runs and lowered ceilings added, removed or moved. */
function installationChanges(a: Scenario, b: Scenario) {
  const key = (x: unknown) => JSON.stringify(x)
  const all = (s: Scenario) => [...s.fixtures, ...s.runs, ...s.loweredCeilings] as { id: string }[]
  const before = new Map(all(a).map((x) => [x.id, key(x)]))
  const after = new Map(all(b).map((x) => [x.id, key(x)]))
  return {
    added: [...after.keys()].filter((id) => !before.has(id)).length,
    removed: [...before.keys()].filter((id) => !after.has(id)).length,
    moved: [...after].filter(([id, k]) => before.has(id) && before.get(id) !== k).length,
  }
}
