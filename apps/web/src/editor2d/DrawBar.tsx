import { useStore, type Modifiers, type Tool } from '../store.ts'
import { cleanLength, MIN_TYPED_LENGTH, parseLength } from './wallLength.ts'

/** The tools that draw a chain of points, ended with «Ferdig» (a double-click, Escape or right-click with a mouse). */
const CHAIN_TOOLS: readonly Tool[] = ['wall', 'room', 'ceiling', 'run']

export interface DrawBarProps {
  tool: Tool
  /** A finger: the bar is there for as long as the tool is, not only while something is drawn. */
  coarse: boolean
  /** Points are placed: a wall, room, ceiling or run is under way, or the first calibration point. */
  drawing: boolean
  /** The wall tool has its start point, so a length can be typed. */
  wallStarted: boolean
  /** The typed length of the wall being drawn (shared with the keyboard path), or null. */
  length: string | null
  onLength(text: string | null): void
  /** Places the wall at the typed length, as Enter does. */
  onSetLength(): void
  /** The measuring tool shows a measurement. */
  measuring: boolean
  onClearMeasurement(): void
  onFinish(): void
  onCancel(): void
  /** How far from the bottom of the plan the bar sits, in px (above the phone's bottom sheet). */
  bottom?: number
}

/**
 * Buttons at the bottom of the plan for what the keyboard does while drawing: «Ferdig» (double-click,
 * Escape or right-click), «Avbryt» (Escape), the wall's length (digits and Enter), «Fjern måling», and
 * toggles that stand in for the keys held while pointing: «Fri vinkel» (Shift), «Uten rutenett» (Alt)
 * and, with Velg, «Velg flere» (Shift+click, Shift+drag).
 *
 * A finger (coarse pointer) has it whenever the tool has something to offer; a mouse only while
 * something is being drawn or measured, so the desktop plan looks as before the rest of the time.
 */
export function DrawBar(props: DrawBarProps) {
  const { tool, coarse, drawing, wallStarted, measuring } = props
  const modifiers = useStore((s) => s.modifiers)
  const chain = CHAIN_TOOLS.includes(tool)
  const showToggles = (chain || tool === 'measure') && (coarse || drawing || measuring)
  const showFinish = chain && drawing
  const showCancel = (chain || tool === 'calibrate') && drawing
  const showLength = tool === 'wall' && wallStarted
  const showClear = tool === 'measure' && measuring
  const showSelectMany = tool === 'select' && coarse
  if (!showToggles && !showCancel && !showClear && !showSelectMany) return null

  const toggle = (name: keyof Modifiers, label: string, title: string) => (
    <button
      type="button"
      className={modifiers[name] ? 'active' : ''}
      aria-pressed={modifiers[name]}
      title={title}
      onClick={() => useStore.getState().setModifier(name, !modifiers[name])}
    >
      {label}
    </button>
  )
  const canSet = parseLength(props.length) > MIN_TYPED_LENGTH

  return (
    <div className="drawbar" role="toolbar" aria-label="Tegning" style={{ bottom: 8 + (props.bottom ?? 0) }}>
      {showFinish && (
        <button type="button" className="primary" onClick={props.onFinish} title="Avslutt (dobbeltklikk eller Esc)">
          Ferdig
        </button>
      )}
      {showCancel && (
        <button type="button" onClick={props.onCancel} title="Forkast det som er tegnet nå (Esc)">
          Avbryt
        </button>
      )}
      {showLength && (
        <form
          className="drawbar-length"
          onSubmit={(e) => {
            e.preventDefault()
            props.onSetLength()
          }}
        >
          <label>
            Lengde (m)
            <input
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              placeholder="3,2"
              value={props.length ?? ''}
              onChange={(e) => props.onLength(cleanLength(e.target.value))}
            />
          </label>
          <button type="submit" disabled={!canSet} title="Sett veggen med denne lengden (Enter)">
            Sett
          </button>
        </form>
      )}
      {showClear && (
        <button type="button" onClick={props.onClearMeasurement} title="Fjern målingen (Esc)">
          Fjern måling
        </button>
      )}
      {showToggles && toggle('freeAngle', 'Fri vinkel', 'Tegn i alle vinkler, ikke bare i 45°-trinn (som Shift)')}
      {showToggles && toggle('noGrid', 'Uten rutenett', 'Ikke fest punktene til 10 cm-rutenettet (som Alt)')}
      {showSelectMany &&
        toggle(
          'additive',
          'Velg flere',
          'Et trykk legger til eller fjerner én ting, og en finger på et tomt område drar en ramme (som Shift)',
        )}
    </div>
  )
}
