import { describe, expect, it } from 'vitest'
import { v } from './geometry.ts'
import { emptyScenario, type Wall } from './model.ts'
import { describeRoomSides, redetectRooms } from './scenario.ts'

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id,
  a: v(ax, ay),
  b: v(bx, by),
  thickness: 0.1,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
})

describe('redetectRooms', () => {
  it('keeps names of rooms that still exist and assigns furniture', () => {
    let s = redetectRooms({
      ...emptyScenario(),
      walls: [wall('t', 0, 0, 4, 0), wall('r', 4, 0, 4, 3), wall('b', 4, 3, 0, 3), wall('l', 0, 3, 0, 0)],
    })
    s = {
      ...s,
      rooms: s.rooms.map((r) => ({ ...r, name: 'Stue' })),
      furniture: [{ id: 'f', catalogId: 'kommode', x: 1, y: 1, rotation: 0, roomId: null, size: null, label: null }],
    }
    const again = redetectRooms(s)
    expect(again.rooms[0]!.name).toBe('Stue')
    expect(again.furniture[0]!.roomId).toBe(again.rooms[0]!.id)
  })
})

describe('describeRoomSides', () => {
  it('lists each side with its length, windows and doors to neighbouring rooms', () => {
    const walls = [
      wall('t', 0, 0, 6, 0),
      wall('r', 6, 0, 6, 3),
      wall('b', 6, 3, 0, 3),
      wall('l', 0, 3, 0, 0),
      wall('m', 4, 0, 4, 3),
    ]
    let s = redetectRooms({ ...emptyScenario(), walls })
    s = {
      ...s,
      rooms: s.rooms.map((r) => ({ ...r, name: r.polygon.some((p) => p.x > 5) ? 'Bad' : 'Stue' })),
      openings: [
        { id: 'w1', wallId: 't', kind: 'window', offset: 2, width: 1.2, height: 1.2, sill: 0.9, flip: false },
        { id: 'd1', wallId: 'm', kind: 'door', offset: 1.5, width: 0.8, height: 2.1, sill: 0, flip: false },
      ],
    }
    const stue = s.rooms.find((r) => r.name === 'Stue')!
    const text = describeRoomSides(s, stue.id)
    expect(text).toMatch(/øverst.*vindu 120 cm/)
    expect(text).toMatch(/til høyre.*dør 80 cm til «Bad»/)
    expect(text).toMatch(/til venstre.*ingen dører eller vinduer/)
  })
})
