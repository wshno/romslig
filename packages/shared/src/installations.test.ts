import { describe, expect, it } from 'vitest'
import { v } from './geometry.ts'
import { describeInstallations, installationsInWall, loweredCeilingAt, runLength, type Run } from './installations.ts'
import type { Wall } from './model.ts'

const wall: Wall = { id: 'w', a: v(0, 0), b: v(4, 0), thickness: 0.1, height: 2.4, loadBearing: 'no', exterior: false }
const run = (id: string, placement: Run['placement'], pts: [number, number][]): Run => ({
  id,
  kind: 'drain',
  placement,
  points: pts.map(([x, y]) => v(x, y)),
  z: 0,
  diameter: 0.11,
  label: null,
  note: null,
})

describe('installationsInWall', () => {
  it('finds wall-mounted fixtures and runs laid in the wall, not runs in the floor beside it', () => {
    const found = installationsInWall(
      {
        fixtures: [
          { id: 'a', kind: 'outlet', x: 1, y: 0.05, z: 0.3, wallId: 'w', label: null, note: null },
          { id: 'b', kind: 'outlet', x: 1, y: 0.05, z: 0.3, wallId: null, label: null, note: null },
          { id: 'c', kind: 'outlet', x: 1, y: 1, z: 0.3, wallId: null, label: null, note: null },
        ],
        runs: [
          run('in', 'wall', [
            [0.5, 0],
            [3, 0],
          ]),
          run('across', 'wall', [
            [2, -1],
            [2, 1],
          ]),
          run('floor', 'floor', [
            [0.5, 0],
            [3, 0],
          ]),
          run('far', 'wall', [
            [0, 2],
            [4, 2],
          ]),
        ],
      },
      wall,
    )
    expect(found.fixtures.map((f) => f.id)).toEqual(['a', 'b'])
    expect(found.runs.map((r) => r.id)).toEqual(['in', 'across'])
    expect(describeInstallations(found)).toBe('2 × stikkontakt, avløp')
  })
})

describe('helpers', () => {
  it('measures runs and finds lowered ceilings', () => {
    expect(
      runLength(
        run('r', 'floor', [
          [0, 0],
          [3, 0],
          [3, 4],
        ]),
      ),
    ).toBeCloseTo(7)
    const ceilings = [
      { id: 'c1', polygon: [v(0, 0), v(2, 0), v(2, 2), v(0, 2)], height: 2.2, label: null },
      { id: 'c2', polygon: [v(0, 0), v(1, 0), v(1, 1), v(0, 1)], height: 2.0, label: null },
    ]
    expect(loweredCeilingAt(v(0.5, 0.5), ceilings)?.id).toBe('c2')
    expect(loweredCeilingAt(v(1.5, 1.5), ceilings)?.id).toBe('c1')
    expect(loweredCeilingAt(v(3, 3), ceilings)).toBeNull()
  })
})
