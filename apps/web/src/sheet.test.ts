import { describe, expect, it } from 'vitest'
import { nearestSnap, snapAfter, snapForPhotoFlow, snapOnFocus, snapOnTap, type SheetWatch } from './sheet.ts'

const sofa = { kind: 'furniture', id: 'f1' } as const
const wall = { kind: 'wall', id: 'w1' } as const
const watch = (over: Partial<SheetWatch> = {}): SheetWatch => ({
  tool: 'select',
  selection: [],
  furnitureIds: [],
  ...over,
})

describe('snapAfter', () => {
  it('goes down when a drawing tool is picked, from wherever it was', () => {
    expect(snapAfter('full', watch(), watch({ tool: 'wall' }))).toBe('closed')
    expect(snapAfter('half', watch({ tool: 'wall' }), watch({ tool: 'room' }))).toBe('closed')
  })

  it('stays where it is when the tool goes back to Velg', () => {
    expect(snapAfter('closed', watch({ tool: 'wall' }), watch())).toBe('closed')
  })

  it('comes up to half when something is selected, but does not come down from full', () => {
    expect(snapAfter('closed', watch(), watch({ selection: [wall] }))).toBe('half')
    expect(snapAfter('full', watch(), watch({ selection: [wall] }))).toBe('full')
    // Picking something else keeps the height the user chose
    expect(snapAfter('half', watch({ selection: [wall] }), watch({ selection: [sofa], furnitureIds: ['f1'] }))).toBe(
      'half',
    )
  })

  it('stays put when the selection is cleared or the same', () => {
    const selection = [wall]
    expect(snapAfter('half', watch({ selection }), watch())).toBe('half')
    expect(snapAfter('half', watch({ selection }), watch({ selection }))).toBe('half')
  })

  it('goes down when a piece is added from the catalog, so it can be seen in the plan', () => {
    expect(snapAfter('full', watch(), watch({ selection: [sofa], furnitureIds: ['f1'] }))).toBe('closed')
  })

  it('opens for a piece that was already there, and for a duplicate made from a selection', () => {
    expect(
      snapAfter('closed', watch({ furnitureIds: ['f1'] }), watch({ selection: [sofa], furnitureIds: ['f1'] })),
    ).toBe('half')
    const copy = { kind: 'furniture', id: 'f2' } as const
    expect(
      snapAfter(
        'half',
        watch({ selection: [sofa], furnitureIds: ['f1'] }),
        watch({ selection: [copy], furnitureIds: ['f1', 'f2'] }),
      ),
    ).toBe('half')
  })
})

describe('snapForPhotoFlow', () => {
  it('takes the full height while the photo flow is open, from wherever it was', () => {
    expect(snapForPhotoFlow('open', 'closed', 'closed')).toBe('full')
    expect(snapForPhotoFlow('open', 'half', 'half')).toBe('full')
  })

  it('goes back to where it was when the flow is closed', () => {
    expect(snapForPhotoFlow('cancel', 'full', 'half')).toBe('half')
    expect(snapForPhotoFlow('cancel', 'full', 'closed')).toBe('closed')
  })

  it('goes down when the furniture is added, so the plan shows it', () => {
    expect(snapForPhotoFlow('placed', 'full', 'half')).toBe('closed')
  })

  it('stays when the flow leaves the screen some other way', () => {
    expect(snapForPhotoFlow('gone', 'full', 'half')).toBe('full')
    expect(snapForPhotoFlow('gone', 'closed', 'half')).toBe('closed')
  })
})

describe('snapOnTap', () => {
  it('steps up, and from the top back down', () => {
    expect(snapOnTap('closed')).toBe('half')
    expect(snapOnTap('half')).toBe('full')
    expect(snapOnTap('full')).toBe('closed')
  })
})

describe('snapOnFocus', () => {
  it('goes to full height for a text area, so the keyboard leaves room for it', () => {
    expect(snapOnFocus('half', { tagName: 'TEXTAREA' })).toBe('full')
    expect(snapOnFocus('full', { tagName: 'TEXTAREA' })).toBe('full')
  })

  it('stays for other fields and buttons', () => {
    expect(snapOnFocus('half', { tagName: 'INPUT' })).toBe('half')
    expect(snapOnFocus('closed', { tagName: 'BUTTON' })).toBe('closed')
  })
})

describe('nearestSnap', () => {
  const heights = { closed: 70, half: 300, full: 600 }
  it('lets go at the nearest resting height', () => {
    expect(nearestSnap(90, heights)).toBe('closed')
    expect(nearestSnap(200, heights)).toBe('half')
    expect(nearestSnap(420, heights)).toBe('half')
    expect(nearestSnap(500, heights)).toBe('full')
    expect(nearestSnap(900, heights)).toBe('full')
  })
})
