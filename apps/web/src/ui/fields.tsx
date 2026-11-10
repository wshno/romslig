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
}

/**
 * A number field. While it is typed in it shows what was typed, and on Enter or when focus leaves
 * it, the stored value. They differ when the value has a limit: writing the limit back under the cursor
 * would turn "0.9" into "0.29" in a field where 0.2 is the smallest value allowed.
 */
export function Num({ label, value, onChange, step = 0.01, unit = 'm', min, perUnit = 1, digits = 3 }: NumProps) {
  const [typed, setTyped] = useState<string | null>(null)
  const round = 10 ** digits
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
            const v = parseFloat(e.target.value)
            if (!Number.isNaN(v)) onChange(v / perUnit)
          }}
          onBlur={() => setTyped(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setTyped(null)
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
