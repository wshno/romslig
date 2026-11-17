import { describe, expect, it } from 'vitest'
import type { Room } from '@romslig/shared'
import { pickedCornerOf } from './cornerPick.ts'

const room = (id: string, corners: number): Room =>
  ({ id, polygon: Array.from({ length: corners }, (_, i) => ({ x: i, y: i % 2 })) }) as unknown as Room

describe('pickedCornerOf', () => {
  it('is the touched corner while its room has the handles', () => {
    expect(pickedCornerOf({ roomId: 'r1', index: 2 }, room('r1', 4))).toBe(2)
  })

  it('is nothing without a touch, without a room, or for another room', () => {
    expect(pickedCornerOf(null, room('r1', 4))).toBeNull()
    expect(pickedCornerOf({ roomId: 'r1', index: 0 }, undefined)).toBeNull()
    expect(pickedCornerOf({ roomId: 'r1', index: 0 }, room('r2', 4))).toBeNull()
  })

  it('is nothing when undo took the corner away', () => {
    expect(pickedCornerOf({ roomId: 'r1', index: 4 }, room('r1', 4))).toBeNull()
  })
})
