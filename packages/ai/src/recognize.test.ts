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
  customFurniture: [],
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
      customFurniture: [],
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
          match: 'good',
          proposal: null,
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
          match: 'good',
          proposal: null,
        },
      ],
    })
    expect(requests[0]!.body).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { format: { type: 'json_schema' } },
    })
  })

  it('keeps a proposal for furniture that does not match the catalog, and knows the project\x27s own furniture', async () => {
    const own = {
      id: 'custom_abc',
      name: 'Hjørnesofa',
      category: 'stue' as const,
      w: 2.6,
      d: 1.6,
      h: 0.85,
      clearance: { front: 0.5, back: 0, sides: 0 },
      shape: 'sofa' as const,
      color: '#7d8fa6',
      nameEn: 'Corner sofa',
      description: 'L-shaped sofa',
    }
    const withOwn = { ...project, customFurniture: [own] }
    const answer = {
      items: [
        {
          catalog_id: CATALOG[0]!.id,
          name: 'Svart flygel',
          width_cm: 150,
          depth_cm: 190,
          height_cm: 100,
          side: 'free',
          position_hint: 'midt i rommet',
          confidence: 'medium',
          photo: 1,
          match: 'none',
          proposal: {
            name: 'Flygel',
            name_en: 'Grand piano',
            category: 'stue',
            shape: 'box',
            width_cm: 150,
            depth_cm: 190,
            height_cm: 100,
            clearance_front_cm: 80,
            clearance_sides_cm: 0,
            clearance_back_cm: 0,
            description_en: 'A black grand piano with the lid closed.',
            needs_new_shape: true,
          },
        },
        {
          catalog_id: 'custom_abc',
          name: 'Hjørnesofaen',
          width_cm: 260,
          depth_cm: 160,
          height_cm: 85,
          side: 'left',
          position_hint: 'i hjørnet',
          confidence: 'high',
          photo: 1,
          match: 'good',
          proposal: null,
        },
      ],
      notes: '',
    }
    const { client, requests } = fakeClient([{ content: [{ type: 'text', text: JSON.stringify(answer) }] }])
    const r = await recognizeFurniture(client, RecognizeRequest.parse({ project: withOwn, roomId: 'r1', images }))
    expect(r.items[0]!.match).toBe('none')
    expect(r.items[0]!.proposal).toMatchObject({
      name: 'Flygel',
      nameEn: 'Grand piano',
      w: 1.5,
      d: 1.9,
      needsNewShape: true,
    })
    expect(r.items[0]!.proposal!.clearance).toEqual({ front: 0.8, back: 0, sides: 0 })
    expect(r.items[1]).toMatchObject({ catalogId: 'custom_abc', match: 'good', proposal: null })
    // The prompt lists the project\x27s own furniture, and the schema accepts its id
    const body = JSON.stringify(requests[0]!.body)
    expect(body).toContain('custom_abc | Hjørnesofa')
    expect(body).toContain('custom_abc')
  })

  it('rejects an unknown room without calling Claude', async () => {
    const { client, requests } = fakeClient([])
    await expect(
      recognizeFurniture(client, RecognizeRequest.parse({ project, roomId: 'nope', images })),
    ).rejects.toThrow('Fant ikke rommet.')
    expect(requests).toHaveLength(0)
  })
})
