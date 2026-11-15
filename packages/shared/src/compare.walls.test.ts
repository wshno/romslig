import { describe, expect, it } from 'vitest'
import { compareScenarios } from './compare.ts'
import { v } from './geometry.ts'
import { emptyScenario, type Opening, type Scenario, type Wall } from './model.ts'
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

const opening = (id: string, wallId: string, kind: Opening['kind'], width = 1): Opening => ({
  id,
  wallId,
  kind,
  offset: 1,
  width,
  height: 2,
  sill: kind === 'window' ? 0.9 : 0,
  flip: false,
})

/** A 6 × 3 m flat with load-bearing exterior walls and a light partition in the middle. */
function base(): Scenario {
  const outer = { loadBearing: 'yes' as const, exterior: true, thickness: 0.25 }
  return redetectRooms({
    ...emptyScenario(),
    walls: [
      wall('t', 0, 0, 6, 0, outer),
      wall('r', 6, 0, 6, 3, outer),
      wall('b', 6, 3, 0, 3, outer),
      wall('l', 0, 3, 0, 0, outer),
      wall('m', 3, 0, 3, 3),
    ],
    openings: [opening('door', 'm', 'door', 0.8), opening('win', 't', 'window', 1.2)],
  })
}

describe('compareScenarios for walls and openings', () => {
  it('lists added, removed and resized openings', () => {
    const a = base()
    const b = {
      ...a,
      openings: [opening('door', 'm', 'door', 1), opening('new', 'm', 'opening')],
    }

    const c = compareScenarios(a, b)

    expect(c.openings.removed.map((o) => o.id)).toEqual(['win'])
    expect(c.openings.added.map((o) => o.id)).toEqual(['new'])
    expect(c.openings.resized.map((o) => o.id)).toEqual(['door'])
    expect(c.flags).toEqual([])
  })

  it('flags a new window in a load-bearing exterior wall', () => {
    const a = base()
    const c = compareScenarios(a, { ...a, openings: [...a.openings, opening('w2', 'r', 'window')] })
    expect(c.flags.join(' ')).toMatch(/Nytt vindu i yttervegg/)
    expect(c.flags.join(' ')).toMatch(/kan være bærende/)
  })

  it('flags moving a load-bearing exterior wall', () => {
    const a = base()
    const b = redetectRooms({
      ...a,
      walls: a.walls.map((w) => (w.id === 'r' ? { ...w, a: v(7, 0), b: v(7, 3) } : w)),
    })

    const c = compareScenarios(a, b)

    expect(c.walls.moved.map((w) => w.id)).toEqual(['r'])
    expect(c.flags.join(' ')).toMatch(/bærende vegg er fjernet eller flyttet/)
    expect(c.flags.join(' ')).toMatch(/Yttervegg er endret/)
  })

  it('counts installations added, removed and moved', () => {
    const a = {
      ...base(),
      fixtures: [
        { id: 'x1', kind: 'outlet' as const, x: 1, y: 0.2, z: 0.3, wallId: null, label: null, note: null },
        { id: 'x2', kind: 'switch' as const, x: 2, y: 0.2, z: 1.1, wallId: null, label: null, note: null },
      ],
    }
    const b = {
      ...a,
      fixtures: [
        { ...a.fixtures[0]!, x: 1.5 },
        { id: 'x3', kind: 'data' as const, x: 2, y: 0.2, z: 0.3, wallId: null, label: null, note: null },
      ],
    }
    expect(compareScenarios(a, b).installations).toEqual({ added: 1, removed: 1, moved: 1 })
  })
})
