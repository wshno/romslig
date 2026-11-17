import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { STANDING, stickInput, type WalkInput } from './walkMotion.ts'

/**
 * The stick for walking with a thumb, bottom left over the 3D view. A plain DOM element rather than
 * part of the scene, so the thumb on it and a finger turning the view are two separate pointers. The
 * stick holds on to its pointer, so the thumb can slide off it and keep walking.
 */
export function WalkStick({ stickRef }: { stickRef: RefObject<WalkInput> }) {
  const knobRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<number | null>(null)

  // Walking stops with the stick, also when the walk ends while the thumb is still down
  useEffect(
    () => () => {
      stickRef.current = STANDING
    },
    [stickRef],
  )

  const follow = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const { knob, input } = stickInput(
      e.clientX - (r.left + r.width / 2),
      e.clientY - (r.top + r.height / 2),
      r.width / 2,
    )
    stickRef.current = input
    // Straight to the DOM: this runs for every move of the thumb, and nothing else depends on it
    if (knobRef.current) knobRef.current.style.transform = `translate(${knob.x}px, ${knob.y}px)`
  }
  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointerRef.current) return
    pointerRef.current = null
    stickRef.current = STANDING
    if (knobRef.current) knobRef.current.style.transform = ''
  }

  return (
    <div
      className="walk-stick"
      role="group"
      aria-label="Styrespak for å gå"
      onPointerDown={(e) => {
        if (pointerRef.current !== null) return
        e.preventDefault()
        pointerRef.current = e.pointerId
        e.currentTarget.setPointerCapture?.(e.pointerId)
        follow(e)
      }}
      onPointerMove={(e) => {
        if (e.pointerId === pointerRef.current) follow(e)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div className="walk-stick-knob" ref={knobRef} />
    </div>
  )
}
