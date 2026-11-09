import { useState } from 'react'
import {
  CATALOG,
  CATEGORY_LABELS,
  FURNITURE_CATEGORIES,
  findFreeSpot,
  getCatalogItem,
  itemSize,
  polygonArea,
  polygonCentroid,
  type CatalogItem,
  type FurnitureCategory,
  type FurnitureItem,
  type RoomType,
  type Scenario,
} from '@romslig/shared'
import { FURNITURE_DND_TYPE } from '../dnd.ts'
import { describeIssue, useFurnitureIssues } from '../hooks.ts'
import { activeScenario, useStore } from '../store.ts'

const cm = (m: number) => Math.round(m * 100)
const dims = (c: Pick<CatalogItem, 'w' | 'd' | 'h'>) => `${cm(c.w)}×${cm(c.d)}×${cm(c.h)} cm`

/** Which room types a catalog category naturally belongs in, for click-to-place. */
const CATEGORY_ROOMS: Record<FurnitureCategory, RoomType[]> = {
  stue: ['stue'],
  spis: ['kjøkken', 'stue'],
  soverom: ['soverom'],
  kjøkken: ['kjøkken', 'stue'],
  bad: ['bad', 'wc', 'vaskerom'],
  gang: ['gang', 'entré'],
  kontor: ['kontor', 'soverom', 'stue'],
}

/**
 * Where an item added by clicking goes: a free spot in a room that suits it (bed → bedroom), trying
 * matching rooms largest first, then any room; else the middle of the plan.
 */
function placementFor(cat: CatalogItem, scenario: Scenario): { x: number; y: number; rotation: number } {
  const rooms = [...scenario.rooms].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))
  const matching = rooms.filter((r) => CATEGORY_ROOMS[cat.category].includes(r.type))
  // Prefer a room of the right type, even if it means a crowded spot there; other rooms only if none match
  for (const room of matching.length ? matching : rooms) {
    const spot = findFreeSpot(scenario, cat.id, room)
    if (spot) return spot
  }
  const room = matching[0] ?? rooms[0]
  if (room) return { ...polygonCentroid(room.polygon), rotation: 0 }
  const pts = scenario.walls.flatMap((w) => [w.a, w.b])
  if (!pts.length) return { x: 2, y: 2, rotation: 0 }
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    rotation: 0,
  }
}

export function FurnitureCatalog() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FurnitureCategory | 'alle'>('alle')
  const q = query.trim().toLowerCase()
  const items = CATALOG.filter(
    (c) => (category === 'alle' || c.category === category) && (!q || c.name.toLowerCase().includes(q)),
  )
  const add = (c: CatalogItem) => {
    const sc = activeScenario(useStore.getState().project!)
    const spot = placementFor(c, sc)
    useStore.getState().addFurniture(c.id, spot, { snap: false, rotation: spot.rotation })
  }
  return (
    <section className="catalog">
      <h4>Katalog</h4>
      <p className="muted">Dra et møbel inn i 2D eller 3D, eller klikk for å legge det i et passende rom.</p>
      <div className="row">
        <input placeholder="Søk…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value as FurnitureCategory | 'alle')}>
          <option value="alle">Alle</option>
          {FURNITURE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <ul className="catalog-list">
        {items.map((c) => (
          <li key={c.id}>
            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(FURNITURE_DND_TYPE, c.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => add(c)}
              title="Dra inn i tegningen, eller klikk for å legge til"
            >
              <i style={{ background: c.color }} />
              <span>{c.name}</span>
              <span className="muted">{dims(c)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The furniture in the active scenario, with problem markers. */
export function FurnitureList({ roomId }: { roomId?: string }) {
  const scenario = useStore((s) => activeScenario(s.project!))
  const issues = useFurnitureIssues()
  const select = useStore((s) => s.select)
  const items = roomId ? scenario.furniture.filter((f) => f.roomId === roomId) : scenario.furniture
  if (!items.length) return <p className="muted">Ingen møbler ennå.</p>
  const problems = items.filter((f) => issues.has(f.id)).length
  return (
    <>
      {problems > 0 && (
        <p className="error">
          {problems} av {items.length} møbler har problemer
        </p>
      )}
      <ul className="room-list">
        {items.map((f) => {
          const cat = getCatalogItem(f.catalogId)
          return (
            <li key={f.id} onClick={() => select({ kind: 'furniture', id: f.id })}>
              <i style={{ background: cat.color }} />
              <span>{f.label ?? cat.name}</span>
              <span className="muted">{dims(itemSize(f, cat))}</span>
              {issues.has(f.id) ? <span className="error">⚠</span> : <span className="ok">✓</span>}
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function FurnitureProps({ item }: { item: FurnitureItem }) {
  const project = useStore((s) => s.project)!
  const scenario = activeScenario(project)
  const issues = useFurnitureIssues().get(item.id) ?? []
  const { select, deleteSelected, updateFurniture, rotateFurniture, duplicateSelected } = useStore.getState()
  const cat = getCatalogItem(item.catalogId)
  const size = itemSize(item, cat)
  const room = scenario.rooms.find((r) => r.id === item.roomId)
  const setSize = (patch: Partial<typeof size>) => updateFurniture(item.id, { size: { ...size, ...patch } })
  const sizeField = (label: string, key: keyof typeof size) => (
    <label className="field">
      <span>{label}</span>
      <span className="num">
        <input
          type="number"
          step={1}
          min={1}
          value={cm(size[key])}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (v > 0) setSize({ [key]: v / 100 })
          }}
        />
        <em>cm</em>
      </span>
    </label>
  )
  return (
    <div className="props">
      <div className="inspector-header">
        <button className="link" onClick={() => select(null)}>
          ← Oversikt
        </button>
        <h3>Møbel</h3>
        <button className="link danger" onClick={deleteSelected} title="Slett (Delete)">
          Slett
        </button>
      </div>
      <p>
        <b>{cat.name}</b>
        <br />
        <span className="muted">
          {CATEGORY_LABELS[cat.category]}
          {room ? ` · ${room.name}` : ''}
        </span>
      </p>
      <label className="field">
        <span>Navn</span>
        <input
          value={item.label ?? ''}
          placeholder={cat.name}
          onChange={(e) => updateFurniture(item.id, { label: e.target.value || null })}
        />
      </label>
      {sizeField('Bredde', 'w')}
      {sizeField('Dybde', 'd')}
      {sizeField('Høyde', 'h')}
      {item.size && (
        <button className="link" onClick={() => updateFurniture(item.id, { size: null })}>
          Tilbakestill til katalogmål ({dims(cat)})
        </button>
      )}
      <label className="field">
        <span>Rotasjon</span>
        <span className="num">
          <input
            type="number"
            step={15}
            value={Math.round(item.rotation)}
            onChange={(e) => updateFurniture(item.id, { rotation: ((parseFloat(e.target.value) % 360) + 360) % 360 })}
          />
          <em>°</em>
        </span>
      </label>
      <div className="row">
        <button onClick={() => rotateFurniture(item.id, -90)} title="Q">
          ↺ 90°
        </button>
        <button onClick={() => rotateFurniture(item.id, 90)} title="E">
          ↻ 90°
        </button>
        <button onClick={duplicateSelected} title="Ctrl+D">
          Dupliser
        </button>
      </div>
      {cat.clearance.front + cat.clearance.sides + cat.clearance.back > 0 && (
        <p className="muted">
          Trenger fri plass:{' '}
          {[
            cat.clearance.front && `${cm(cat.clearance.front)} cm foran`,
            cat.clearance.sides && `${cm(cat.clearance.sides)} cm på sidene`,
            cat.clearance.back && `${cm(cat.clearance.back)} cm bak`,
          ]
            .filter(Boolean)
            .join(', ')}
        </p>
      )}
      {issues.length > 0 ? (
        <ul className="warnings">
          {issues.map((i) => {
            const text = describeIssue(i, scenario, item.catalogId)
            return <li key={text}>{text}</li>
          })}
        </ul>
      ) : (
        <p className="ok">Ingen problemer</p>
      )}
      <p className="muted">
        Dra for å flytte (snapper mot vegger, hold Shift for fri plassering). Dra det runde håndtaket for å rotere. Q/E
        roterer 90°.
      </p>
    </div>
  )
}
