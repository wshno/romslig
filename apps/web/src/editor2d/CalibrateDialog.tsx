import { useEffect, useId, useRef, useState } from 'react'
import { cleanLength, parseLength } from './wallLength.ts'

/**
 * Asks for the real distance between the two calibration points. A dialog of our own rather than
 * window.prompt: it gets a number keyboard on a phone (inputmode="decimal"), takes "3,6" the
 * Norwegian way, and looks like the rest of the app. Escape (handled by the drawing tool), «Avbryt»
 * and a tap beside it give up; the points are dropped and the tool stays.
 */
export function CalibrateDialog({ onDone }: { onDone(meters: number | null): void }) {
  const [text, setText] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const meters = parseLength(text)
  const valid = meters > 0
  useEffect(() => inputRef.current?.focus(), [])
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onDone(null)}>
      <form
        className="modal calibrate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onDone(meters)
        }}
      >
        <h3 id={titleId}>Kalibrer</h3>
        <label className="calibrate-field">
          <span>Hvor langt er dette i virkeligheten? (meter)</span>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="f.eks. 3,6"
            value={text ?? ''}
            onChange={(e) => setText(cleanLength(e.target.value))}
          />
        </label>
        <div className="row">
          <button type="submit" className="primary" disabled={!valid}>
            Bruk målet
          </button>
          <button type="button" onClick={() => onDone(null)}>
            Avbryt
          </button>
        </div>
      </form>
    </div>
  )
}
