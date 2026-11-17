import { useEffect, useRef, type RefObject } from 'react'
import Konva from 'konva'
import type { Vec2 } from '@romslig/shared'
import { pinchView } from './pinch.ts'
import type { PlanView } from './Plan2D.tsx'

/**
 * How far (screen px) a finger must move before a press becomes a drag. A fingertip wobbles more
 * than a mouse, and with Konva's 3 px most taps would turn into a small pan and select nothing.
 */
export const TOUCH_DRAG_DISTANCE = 10
const MOUSE_DRAG_DISTANCE = Konva.dragDistance

export interface TouchGestures {
  /** True from the moment a second finger touches until every finger has let go. */
  multiTouchRef: RefObject<boolean>
  /** The type of the last pointer pressed on the plan ('mouse', 'pen' or 'touch'). */
  lastPointerTypeRef: RefObject<string>
}

/**
 * Pinch to zoom and two-finger panning on the plan, in every tool, and a drag threshold that
 * suits the pointer that pressed.
 *
 * Listens on the plan's container in the capture phase, so it sees each pointer before Konva's
 * own listeners on the canvas below it, and whether or not Konva is in the middle of a drag (Konva
 * holds back pointermove while something is dragged). When a second finger comes down, whatever
 * the first one started is called off: the stage or shape drag stops, and from then on the
 * fingers' pointer and touchstart events are kept from Konva until all of them are lifted. So a
 * pinch never ends as a tap that selects something or places a point, and the extra finger never
 * starts a drag of its own. Mouse and pen are left alone.
 */
export function useTouchGestures(
  containerRef: RefObject<HTMLElement | null>,
  stageRef: RefObject<Konva.Stage | null>,
  setView: (v: PlanView) => void,
): TouchGestures {
  const multiTouchRef = useRef(false)
  const lastPointerTypeRef = useRef('mouse')
  // The handlers are attached once: they reach the current setter through a ref
  const setViewRef = useRef(setView)
  useEffect(() => {
    setViewRef.current = setView
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    /** Fingers on the plan, in screen pixels relative to the stage's container. */
    const fingers = new Map<number, Vec2>()
    let pinch: { ids: [number, number]; from: [Vec2, Vec2]; view: PlanView } | null = null

    const local = (ev: PointerEvent): Vec2 | null => {
      const stage = stageRef.current
      if (!stage) return null
      const r = stage.container().getBoundingClientRect()
      return { x: ev.clientX - r.left, y: ev.clientY - r.top }
    }

    const startPinch = (stage: Konva.Stage) => {
      // Call off what the first finger started: a pan of the stage or a drag of a shape. Stopping
      // a drag that has not moved yet also cancels the click Konva would fire when it is released.
      for (const { node } of [...Konva.DD._dragElements.values()]) if (node.getStage() === stage) node.stopDrag()
      const [a, b] = [...fingers.entries()]
      if (!a || !b) return
      // The stage may have been panned by the first finger without the view knowing yet
      pinch = {
        ids: [a[0], b[0]],
        from: [a[1], b[1]],
        view: { scale: stage.scaleX(), x: stage.x(), y: stage.y() },
      }
    }

    const down = (ev: PointerEvent) => {
      lastPointerTypeRef.current = ev.pointerType
      const stage = stageRef.current
      // Every node inherits the stage's drag distance. Set before Konva sees the press.
      stage?.dragDistance(ev.pointerType === 'touch' ? TOUCH_DRAG_DISTANCE : MOUSE_DRAG_DISTANCE)
      // Only fingers on the drawing: the overlay's buttons keep their own taps
      if (ev.pointerType !== 'touch' || !stage?.container().contains(ev.target as Node)) return
      const p = local(ev)
      if (!p) return
      // The first finger of a new gesture: forget the last one, also a finger whose release went
      // unseen (lifted while the page was hidden, say)
      if (ev.isPrimary || fingers.size === 0) {
        fingers.clear()
        pinch = null
        multiTouchRef.current = false
      }
      fingers.set(ev.pointerId, p)
      if (fingers.size < 2) return
      ev.stopPropagation()
      if (fingers.size === 2 && !multiTouchRef.current) {
        multiTouchRef.current = true
        startPinch(stage)
      }
    }

    const move = (ev: PointerEvent) => {
      if (!fingers.has(ev.pointerId)) return
      const p = local(ev)
      if (p) fingers.set(ev.pointerId, p)
      if (!multiTouchRef.current) return
      ev.stopPropagation()
      if (!pinch) return
      const a = fingers.get(pinch.ids[0])
      const b = fingers.get(pinch.ids[1])
      if (a && b) setViewRef.current(pinchView(pinch.view, pinch.from, [a, b]))
    }

    const up = (ev: PointerEvent) => {
      if (!fingers.has(ev.pointerId)) return
      fingers.delete(ev.pointerId)
      if (!multiTouchRef.current) return
      // Konva never hears that the finger left, so it fires no click or tap for it
      ev.stopPropagation()
      if (pinch?.ids.includes(ev.pointerId)) pinch = null
    }

    // An extra finger's touchstart would let Konva start a drag for it (Konva drags follow touch
    // events, not pointer events)
    const touchStart = (ev: TouchEvent) => {
      if (multiTouchRef.current && fingers.size >= 2) ev.stopPropagation()
    }

    el.addEventListener('pointerdown', down, true)
    el.addEventListener('pointermove', move, true)
    el.addEventListener('pointerup', up, true)
    el.addEventListener('pointercancel', up, true)
    el.addEventListener('touchstart', touchStart, true)
    return () => {
      el.removeEventListener('pointerdown', down, true)
      el.removeEventListener('pointermove', move, true)
      el.removeEventListener('pointerup', up, true)
      el.removeEventListener('pointercancel', up, true)
      el.removeEventListener('touchstart', touchStart, true)
    }
  }, [containerRef, stageRef])

  return { multiTouchRef, lastPointerTypeRef }
}
