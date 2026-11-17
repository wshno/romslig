// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_MODIFIERS, useStore, type Tool } from '../store.ts'
import { CalibrateDialog } from './CalibrateDialog.tsx'
import { DrawBar, type DrawBarProps } from './DrawBar.tsx'

afterEach(() => useStore.setState({ tool: 'select', modifiers: NO_MODIFIERS }))

function bar(over: Partial<DrawBarProps> & { tool: Tool }) {
  const props: DrawBarProps = {
    coarse: true,
    drawing: false,
    wallStarted: false,
    length: null,
    onLength: vi.fn(),
    onSetLength: vi.fn(),
    measuring: false,
    onClearMeasurement: vi.fn(),
    onFinish: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  const view = render(<DrawBar {...props} />)
  return { ...view, props, rerender: (more: Partial<DrawBarProps>) => view.rerender(<DrawBar {...props} {...more} />) }
}

const button = (name: string) => screen.getByRole('button', { name })
const toolbar = () => screen.queryByRole('toolbar', { name: 'Tegning' })

describe('DrawBar', () => {
  it('shows a finger the toggles of a drawing tool before anything is drawn, and Ferdig/Avbryt once it is', () => {
    const { props, rerender } = bar({ tool: 'room' })
    expect(button('Fri vinkel')).toHaveAttribute('aria-pressed', 'false')
    expect(button('Uten rutenett')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ferdig' })).not.toBeInTheDocument()

    rerender({ drawing: true })
    fireEvent.click(button('Ferdig'))
    expect(props.onFinish).toHaveBeenCalledTimes(1)
    fireEvent.click(button('Avbryt'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('stays out of a mouse user’s way until something is drawn or measured', () => {
    const { rerender } = bar({ tool: 'wall', coarse: false })
    expect(toolbar()).not.toBeInTheDocument()
    rerender({ drawing: true, wallStarted: true })
    expect(button('Ferdig')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Lengde (m)' })).toBeInTheDocument()

    rerender({ tool: 'select', drawing: false, wallStarted: false })
    expect(toolbar()).not.toBeInTheDocument()
    rerender({ tool: 'measure', measuring: true })
    expect(button('Fjern måling')).toBeInTheDocument()
  })

  it('switches the store’s toggles, which count as the keys', () => {
    bar({ tool: 'wall' })
    fireEvent.click(button('Fri vinkel'))
    expect(useStore.getState().modifiers.freeAngle).toBe(true)
    expect(button('Fri vinkel')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(button('Uten rutenett'))
    expect(useStore.getState().modifiers).toEqual({ additive: false, freeAngle: true, noGrid: true })
    fireEvent.click(button('Fri vinkel'))
    expect(useStore.getState().modifiers.freeAngle).toBe(false)
  })

  it('has «Velg flere» with Velg on a coarse pointer, and nothing for the opening tools', () => {
    const { rerender } = bar({ tool: 'select' })
    fireEvent.click(button('Velg flere'))
    expect(useStore.getState().modifiers.additive).toBe(true)
    expect(screen.queryByRole('button', { name: 'Fri vinkel' })).not.toBeInTheDocument()
    rerender({ tool: 'door' })
    expect(toolbar()).not.toBeInTheDocument()
  })

  it('offers a wall length field once the wall has its start point, with a decimal keyboard', () => {
    const { props, rerender } = bar({ tool: 'wall', drawing: true })
    expect(screen.queryByRole('textbox', { name: 'Lengde (m)' })).not.toBeInTheDocument()

    rerender({ wallStarted: true })
    const field = screen.getByRole('textbox', { name: 'Lengde (m)' })
    expect(field).toHaveAttribute('inputmode', 'decimal')
    expect(button('Sett')).toBeDisabled()
    // What is typed is cleaned the way the keyboard path writes it
    fireEvent.change(field, { target: { value: '3.2' } })
    expect(props.onLength).toHaveBeenLastCalledWith('3,2')
    fireEvent.change(field, { target: { value: 'm' } })
    expect(props.onLength).toHaveBeenLastCalledWith(null)

    rerender({ wallStarted: true, length: '3,2' })
    expect(field).toHaveValue('3,2')
    fireEvent.click(button('Sett'))
    expect(props.onSetLength).toHaveBeenCalledTimes(1)
    // Enter in the field does the same
    fireEvent.submit(field)
    expect(props.onSetLength).toHaveBeenCalledTimes(2)
  })

  it('removes the measurement with «Fjern måling»', () => {
    const { props } = bar({ tool: 'measure', measuring: true })
    fireEvent.click(button('Fjern måling'))
    expect(props.onClearMeasurement).toHaveBeenCalledTimes(1)
    expect(button('Fri vinkel')).toBeInTheDocument()
  })

  it('sits above what covers the bottom of the plan', () => {
    bar({ tool: 'wall', bottom: 120 })
    expect(toolbar()).toHaveStyle({ bottom: '128px' })
  })
})

describe('CalibrateDialog', () => {
  const dialog = () => screen.getByRole('dialog', { name: 'Kalibrer' })
  const field = () => screen.getByRole('textbox', { name: /Hvor langt/ })

  it('asks for the real distance with a decimal keyboard, and takes a comma', () => {
    const onDone = vi.fn()
    render(<CalibrateDialog onDone={onDone} />)
    expect(dialog()).toBeInTheDocument()
    expect(field()).toHaveFocus()
    expect(field()).toHaveAttribute('inputmode', 'decimal')
    expect(button('Bruk målet')).toBeDisabled()
    fireEvent.change(field(), { target: { value: '6,0' } })
    fireEvent.click(button('Bruk målet'))
    expect(onDone).toHaveBeenCalledWith(6)
  })

  it('gives up with Avbryt or a tap beside it', () => {
    const onDone = vi.fn()
    render(<CalibrateDialog onDone={onDone} />)
    fireEvent.click(button('Avbryt'))
    expect(onDone).toHaveBeenLastCalledWith(null)
    fireEvent.click(dialog().parentElement!)
    expect(onDone).toHaveBeenCalledTimes(2)
    // A tap inside it does not
    fireEvent.click(dialog())
    expect(onDone).toHaveBeenCalledTimes(2)
  })
})
