import { describe, expect, it } from 'vitest'
import { compareScenarios } from './compare.ts'
import { v } from './geometry.ts'
import { emptyScenario, type Scenario, type Wall } from './model.ts'
import { redetectRooms } from './scenario.ts'

const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<Wall> = {}): Wall => ({
  id,
  a: v(ax, ay),
  b: v(bx, by),
  thickness: 0.1,
  height: 2.4,
  loadBearing: 'no',
  exterior: false,
  ...extra,
})

function base(): Scenario {
  const s = redetectRooms({
    ...emptyScenario(),
    walls: [
      wall('t', 0, 0, 6, 0),
      wall('r', 6, 0, 6, 3),
      wall('b', 6, 3, 0, 3),
      wall('l', 0, 3, 0, 0),
      wall('m', 3, 0, 3, 3, { loadBearing: 'unknown' }),
    ],
  })
  return {
    ...s,
    rooms: s.rooms.map((r) =>
      r.polygon.some((p) => p.x > 4)
        ? { ...r, name: 'Bad', type: 'bad' as const }
        : { ...r, name: 'Stue', type: 'stue' as const },
    ),
    furniture: [
      { id: 'f1', catalogId: 'sofa-3', x: 1.5, y: 1, rotation: 0, roomId: null, size: null, label: 'Min sofa' },
    ],
  }
}

describe('compareScenarios', () => {
  it('reports nothing for identical variants', () => {
    const a = base()
    const c = compareScenarios(a, structuredClone(a))
    expect(c.walls.removed).toHaveLength(0)
    expect(c.rooms).toHaveLength(0)
    expect(c.flags).toHaveLength(0)
  })

  it('reports a removed wall, merged rooms, flags and furniture changes', () => {
    const a = base()
    const b0 = redetectRooms({ ...structuredClone(a), walls: a.walls.filter((w) => w.id !== 'm') })
    const b = {
      ...b0,
      furniture: [
        { ...a.furniture[0]!, x: 2 },
        { id: 'f2', catalogId: 'lenestol', x: 4, y: 1, rotation: 0, roomId: null, size: null, label: null },
      ],
    }
    const c = compareScenarios(a, b)
    expect(c.walls.removed.map((w) => w.id)).toEqual(['m'])
    expect(c.rooms.some((r) => r.after === null)).toBe(true) // one room merged away
    expect(c.rooms.find((r) => r.after !== null)!.after!).toBeGreaterThan(
      c.rooms.find((r) => r.after !== null)!.before!,
    )
    expect(c.flags.join(' ')).toMatch(/RIB/)
    expect(c.flags.join(' ')).toMatch(/Våtrom/)
    expect(c.furniture).toEqual({ added: ['Lenestol'], removed: [], moved: ['Min sofa'] })
  })
})
