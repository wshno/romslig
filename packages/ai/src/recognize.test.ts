import { describe, expect, it } from 'vitest'
import { CATALOG, emptyScenario, redetectRooms, v, type Project, type Scenario, type Wall } from '@romslig/shared'
import { RecognizeRequest, buildDescription, recognizeFurniture } from './recognize.ts'
import { fakeClient } from './testing.ts'

const projectWith = (s: Scenario): Project => ({
  id: 'p',
  name: 'p',
  planImage: null,
  calibration: { pxPerMeter: 100, calibrated: true },
  ceilingHeight: 2.4,
  northAngle: 0,
  scenarios: [s],
  activeScenarioId: s.id,
  chat: [],
  version: 0,
  createdAt: '',
  updatedAt: '',
})

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id,
  a: v(ax, ay),
  b: v(bx, by),
  thickness: 0.1,
  height: 2.4,
  loadBearing: 'unknown',
  exterior: false,
})

describe('buildDescription', () => {
  it('spells out which wall is ahead, left, right and behind for photos with a direction', () => {
    const s0 = redetectRooms({
      ...emptyScenario(),
      walls: [wall('t', 0, 0, 4, 0), wall('r', 4, 0, 4, 3), wall('b', 4, 3, 0, 3), wall('l', 0, 3, 0, 0)],
    })
    const s = {
      ...s0,
      rooms: s0.rooms.map((r) => ({ ...r, name: 'Sov 1', type: 'soverom' as const })),
      openings: [
        { id: 'w', wallId: 't', kind: 'window' as const, offset: 2, width: 1.2, height: 1.2, sill: 0.9, flip: false },
      ],
    }
    const project: Project = {
      id: 'p',
      name: 'p',
      planImage: null,
      calibration: { pxPerMeter: 100, calibrated: true },
      ceilingHeight: 2.4,
      northAngle: 0,
      scenarios: [s],
      activeScenarioId: s.id,
      chat: [],
      version: 0,
      createdAt: '',
      updatedAt: '',
    }
    const req = RecognizeRequest.parse({
      project,
      roomId: s.rooms[0]!.id,
      hint: 'sengen er 180 cm',
      images: [
        { mediaType: 'image/jpeg', data: 'x', facing: 'right' },
        { mediaType: 'image/jpeg', data: 'y' },
      ],
    })
    const text = buildDescription(req, s, s.rooms[0]!)
    expect(text).toMatch(/øverst.*vindu 120 cm/)
    expect(text).toContain(
      'Bilde 1: tatt mot veggen til høyre (right). Til venstre i bildet: veggen øverst (top). Til høyre i bildet: veggen nederst (bottom). Bak fotografen: veggen til venstre (left).',
    )
    expect(text).toContain('Bilde 2: retning ikke oppgitt.')
    expect(text).toContain('Tips fra brukeren: sengen er 180 cm')
  })
})

describe('recognizeFurniture', () => {
  const room = { id: 'r1', name: 'Stue', type: 'stue' as const, polygon: [v(0, 0), v(4, 0), v(4, 3), v(0, 3)] }
  const project = projectWith({ ...emptyScenario(), rooms: [{ ...room, statedArea: null }] })
  const images = [{ mediaType: 'image/jpeg', data: 'abc' }]

  it('turns the structured answer into recognised items in meters', async () => {
    const sofa = CATALOG[0]!.id
    const answer = {
      items: [
        {
          catalog_id: sofa,
          name: 'Grå sofa',
          width_cm: 220,
          depth_cm: 90,
          height_cm: 80,
          side: 'left',
          position_hint: 'ved vinduet',
          confidence: 'high',
          photo: 1,
        },
      ],
      notes: 'Ingen usikkerhet',
    }
    const { client, requests } = fakeClient([{ content: [{ type: 'text', text: JSON.stringify(answer) }] }])
    const r = await recognizeFurniture(client, RecognizeRequest.parse({ project, roomId: 'r1', images }))
    expect(r).toEqual({
      roomId: 'r1',
      notes: 'Ingen usikkerhet',
      items: [
        {
          catalogId: sofa,
          name: 'Grå sofa',
          size: { w: 2.2, d: 0.9, h: 0.8 },
          side: 'left',
          positionHint: 'ved vinduet',
          confidence: 'high',
          photo: 1,
        },
      ],
    })
    expect(requests[0]!.body).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { format: { type: 'json_schema' } },
    })
  })

  it('rejects an unknown room without calling Claude', async () => {
    const { client, requests } = fakeClient([])
    await expect(
      recognizeFurniture(client, RecognizeRequest.parse({ project, roomId: 'nope', images })),
    ).rejects.toThrow('Fant ikke rommet.')
    expect(requests).toHaveLength(0)
  })
})
