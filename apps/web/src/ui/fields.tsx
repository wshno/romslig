import { useState } from 'react'

interface NumProps {
  label: string
  /** The stored value, in metres unless `perUnit` says otherwise. */
  value: number
  /** Called with every number typed. The caller may store something else (a limit, a fit). */
  onChange(v: number): void
  step?: number
  unit?: string
  min?: number
  /** How many of the shown unit there are in one of the stored: 100 shows metres as centimetres. */
  perUnit?: number
  /** Decimals shown. */
  digits?: number
  /**
   * Call onChange only on Enter or when focus leaves the field, not on every key. For values where
   * a step on the way does something of its own: typing "12" would first make a wall 1 m long.
   */
  commitOnly?: boolean
}

/**
 * A number field. While it is typed in it shows what was typed, and on Enter or when focus leaves
 * it, the stored value. They differ when the value has a limit: writing the limit back under the cursor
 * would turn "0.9" into "0.29" in a field where 0.2 is the smallest value allowed.
 */
export function Num({
  label,
  value,
  onChange,
  step = 0.01,
  unit = 'm',
  min,
  perUnit = 1,
  digits = 3,
  commitOnly = false,
}: NumProps) {
  const [typed, setTyped] = useState<string | null>(null)
  const round = 10 ** digits
  const commit = () => {
    if (commitOnly && typed !== null) {
      const v = parseFloat(typed)
      if (!Number.isNaN(v)) onChange(v / perUnit)
    }
    setTyped(null)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <span className="num">
        <input
          type="number"
          step={step}
          min={min}
          value={typed ?? Math.round(value * perUnit * round) / round}
          onChange={(e) => {
            // The arrows in the field and on the keyboard step the value: show what it became
            const stepped = !(e.nativeEvent as InputEvent).inputType
            setTyped(stepped ? null : e.target.value)
            if (commitOnly && !stepped) return
            const v = parseFloat(e.target.value)
            if (!Number.isNaN(v)) onChange(v / perUnit)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape' && commitOnly) setTyped(null)
          }}
        />
        <em>{unit}</em>
      </span>
    </label>
  )
}

/** A length stored in metres, shown and typed in whole centimetres. */
export function CmField(props: Pick<NumProps, 'label' | 'value' | 'onChange'>) {
  return <Num {...props} step={1} unit="cm" perUnit={100} digits={0} />
}
