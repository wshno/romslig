import { useState } from 'react'
import { polygonArea, type Room } from '@romslig/shared'
import { activeScenario, useStore } from '../store.ts'
import { singleSelected } from '../selection.ts'
import { ROOM_COLORS, fmtM2 } from '../theme.ts'
import { RecognizePanel } from './RecognizePanel.tsx'
import { clearSession, readSession } from './recognizeSession.ts'

type Step = { step: 'idle' } | { step: 'pick' } | { step: 'open'; roomId: string }

/**
 * The way into photo recognition that does not need a tap on the room in the plan: a button, a
 * list of the variant's rooms, then the panel for the chosen room. With `room` (or a room already
 * selected) the list is skipped. A panel left open in this tab (e.g. before Android reloaded the
 * page on return from the camera) opens again.
 */
export function PhotoEntry({ room, label = '📷 Ta bilde av et rom' }: { room?: Room; label?: string }) {
  const project = useStore((s) => s.project)!
  const selected = useStore((s) => singleSelected(s.selection))
  const scenario = activeScenario(project)
  const known = room ?? (selected?.kind === 'room' ? scenario.rooms.find((r) => r.id === selected.id) : undefined)
  const [state, setState] = useState<Step>(() => {
    const saved = readSession(project.id)
    if (!saved) return { step: 'idle' }
    if (!scenario.rooms.some((r) => r.id === saved.roomId)) {
      clearSession() // the room is gone, or belongs to another variant
      return { step: 'idle' }
    }
    // Another room's panel stays stored until that room (or the overview) is shown
    return !room || room.id === saved.roomId ? { step: 'open', roomId: saved.roomId } : { step: 'idle' }
  })

  const open = state.step === 'open' ? scenario.rooms.find((r) => r.id === state.roomId) : undefined
  if (open) return <RecognizePanel room={open} onClose={() => setState({ step: 'idle' })} />

  if (state.step === 'pick')
    return (
      <div className="photo-entry">
        <div className="row spread">
          <h4>Hvilket rom vil du ta bilde av?</h4>
          <button className="link" onClick={() => setState({ step: 'idle' })}>
            Avbryt
          </button>
        </div>
        {scenario.rooms.length === 0 ? (
          <p className="note">
            Varianten «{scenario.name}» har ingen rom ennå. Tegn rommene med <b>Rom</b>- eller <b>Vegg</b>-verktøyet,
            eller digitaliser plantegningen under <b>Oversikt</b>, så kan du ta bilder av dem.
          </p>
        ) : (
          <ul className="room-picker" aria-label="Velg rom">
            {scenario.rooms.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setState({ step: 'open', roomId: r.id })}>
                  <i style={{ background: ROOM_COLORS[r.type] }} />
                  <span>{r.name}</span>
                  <span className="muted">{fmtM2(polygonArea(r.polygon))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )

  return (
    <button
      className="photo-entry-button"
      onClick={() => setState(known ? { step: 'open', roomId: known.id } : { step: 'pick' })}
    >
      {label}
    </button>
  )
}
