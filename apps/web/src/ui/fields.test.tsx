// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CmField, Num } from './fields.tsx'

/** A change as the user types it: the field reads inputType to tell typing from the step arrows. */
function type(input: HTMLElement, value: string) {
  fireEvent.input(input, { target: { value }, inputType: 'insertText' })
}

describe('Num', () => {
  it('shows the stored value rounded, with its unit', () => {
    render(<Num label="Lengde" value={1.23456} onChange={vi.fn()} />)
    expect(screen.getByRole('spinbutton', { name: /Lengde/ })).toHaveValue(1.235)
    expect(screen.getByText('m')).toBeInTheDocument()
  })

  it('passes on every number typed, and ignores what is not a number', () => {
    const onChange = vi.fn()
    render(<Num label="Høyde" value={2.4} onChange={onChange} perUnit={100} unit="cm" digits={0} />)
    const input = screen.getByRole('spinbutton', { name: /Høyde/ })

    fireEvent.input(input, { target: { value: '250' } })
    expect(onChange).toHaveBeenLastCalledWith(2.5)
    fireEvent.input(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('shows what is typed until Enter, then the stored value', () => {
    render(<Num label="Bredde" value={0.2} onChange={vi.fn()} min={0.2} />)
    const input = screen.getByRole('spinbutton', { name: /Bredde/ })
    type(input, '0.0')
    expect(input).toHaveValue(0)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue(0.2)
  })

  describe('with commitOnly', () => {
    it('passes the number on only on Enter or when focus leaves', () => {
      const onChange = vi.fn()
      render(<Num label="Vegg" value={1} onChange={onChange} commitOnly />)
      const input = screen.getByRole('spinbutton', { name: /Vegg/ })

      type(input, '12')
      expect(onChange).not.toHaveBeenCalled()
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onChange).toHaveBeenCalledWith(12)

      type(input, '3')
      fireEvent.blur(input)
      expect(onChange).toHaveBeenLastCalledWith(3)
    })

    it('drops what was typed on Escape, and does not pass on what is not a number', () => {
      const onChange = vi.fn()
      render(<Num label="Vegg" value={1} onChange={onChange} commitOnly />)
      const input = screen.getByRole('spinbutton', { name: /Vegg/ })

      type(input, '7')
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(input).toHaveValue(1)
      fireEvent.blur(input)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('passes a step of the arrows on at once', () => {
      const onChange = vi.fn()
      render(<Num label="Vegg" value={1} onChange={onChange} commitOnly />)
      fireEvent.change(screen.getByRole('spinbutton', { name: /Vegg/ }), { target: { value: '1.01' } })
      expect(onChange).toHaveBeenCalledWith(1.01)
    })
  })
})

describe('CmField', () => {
  it('shows metres as whole centimetres', () => {
    const onChange = vi.fn()
    render(<CmField label="Dybde" value={0.605} onChange={onChange} />)
    const input = screen.getByRole('spinbutton', { name: /Dybde/ })
    expect(input).toHaveValue(61)
    expect(screen.getByText('cm')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '80' } })
    expect(onChange).toHaveBeenCalledWith(0.8)
  })
})
