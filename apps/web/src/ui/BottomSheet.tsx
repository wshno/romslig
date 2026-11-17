import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { activeScenario, useStore } from '../store.ts'
import {
  nearestSnap,
  snapAfter,
  snapForPhotoFlow,
  snapOnFocus,
  snapOnTap,
  type SheetSnap,
  type SheetWatch,
} from '../sheet.ts'
import { onPhotoFlow, photoFlowOpen, type PhotoFlowEvent } from '../photoFlow.ts'
import { readSession } from './recognizeSession.ts'

const HANDLE_LABELS: Record<SheetSnap, string> = {
  closed: 'Vis panelet',
  half: 'Vis hele panelet',
  full: 'Skjul panelet',
}

/** A finger moves a few pixels on a tap; past this it is a drag. */
const DRAG_SLOP = 6

function watched(): SheetWatch {
  const s = useStore.getState()
  return {
    tool: s.tool,
    selection: s.selection,
    furnitureIds: s.project ? activeScenario(s.project).furniture.map((f) => f.id) : [],
  }
}

interface Drag {
  pointerId: number
  startY: number
  startHeight: number
  heights: Record<SheetSnap, number>
  moved: boolean
}

/**
 * The inspector on a phone: a sheet over the bottom of the view, resting closed (handle and tabs),
 * at half or at full height. A tap on the handle moves it a step, a drag moves it freely and lets go
 * at the nearest of the three. It follows the editor too: up when something is selected, down when a
 * drawing tool is picked or a piece is added from the catalog (see snapAfter). While the photo
 * flow is on screen it takes the full height and leaves those reactions out, and it goes down when
 * the recognised furniture is added (see snapForPhotoFlow), and it goes to full height when a text
 * area in it gets the focus (see snapOnFocus). Its content scrolls inside it.
 */
export function BottomSheet({ label, children }: { label: string; children: ReactNode }) {
  const [snap, setSnap] = useState<SheetSnap>('closed')
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const dragRef = useRef<Drag | null>(null)
  /** The click that ends a drag is not a tap. */
  const draggedRef = useRef(false)
  const bodyId = useId()
  /** The snap as of the last render, and where the sheet was when the photo flow opened. */
  const snapRef = useRef(snap)
  const beforeRef = useRef<SheetSnap | null>(null)

  useEffect(() => {
    snapRef.current = snap
  }, [snap])

  useEffect(() => {
    let last = watched()
    return useStore.subscribe((s) => {
      if (s.tool === last.tool && s.selection === last.selection) return
      const next = watched()
      const prev = last
      last = next
      // The photo flow has the sheet: adding the recognised furniture selects it, and that must not
      // bring the sheet back up after the flow sent it down
      if (photoFlowOpen()) return
      setSnap((current) => snapAfter(current, prev, next))
    })
  }, [])

  useEffect(() => {
    const react = (event: PhotoFlowEvent) => {
      if (event === 'open') beforeRef.current ??= snapRef.current
      const before = beforeRef.current ?? snapRef.current
      if (event !== 'open') beforeRef.current = null
      setSnap((current) => snapForPhotoFlow(event, current, before))
    }
    const off = onPhotoFlow(react)
    if (photoFlowOpen()) {
      // A panel restored after a reload (Android may drop the tab while the camera is open) came on
      // screen before this effect ran
      react('open')
    } else {
      // A stored panel opens again in the Oversikt and Møbler tabs: make sure one of them shows
      const s = useStore.getState()
      if (s.project && s.inspectorTab === 'assistent' && readSession(s.project.id)) s.setInspectorTab('oversikt')
    }
    return off
  }, [])

  /** The three resting heights in px, measured now: the view may have changed size since the last drag. */
  const heights = (): Record<SheetSnap, number> => {
    const sheet = sheetRef.current!
    const full = sheet.parentElement?.clientHeight ?? 0
    const handle = sheet.querySelector<HTMLElement>('.sheet-handle')?.offsetHeight ?? 0
    const tabs = sheet.querySelector<HTMLElement>('.tabs')?.offsetHeight ?? 0
    return { closed: handle + tabs, half: full / 2, full }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight: sheetRef.current?.offsetHeight ?? 0,
      heights: heights(),
      moved: false,
    }
    // Keeps the moves coming when the finger leaves the handle (not in jsdom)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dy = e.clientY - d.startY
    if (!d.moved && Math.abs(dy) < DRAG_SLOP) return
    d.moved = true
    setDragHeight(Math.min(d.heights.full, Math.max(d.heights.closed, d.startHeight - dy)))
  }
  const onPointerEnd = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    if (!d.moved) return
    draggedRef.current = true
    const at = Math.min(d.heights.full, Math.max(d.heights.closed, d.startHeight - (e.clientY - d.startY)))
    setSnap(nearestSnap(at, d.heights))
    setDragHeight(null)
  }

  return (
    <section
      ref={sheetRef}
      className={['sheet', snap, dragHeight !== null && 'dragging'].filter(Boolean).join(' ')}
      style={dragHeight !== null ? { height: dragHeight } : undefined}
      role="region"
      aria-label={label}
    >
      <button
        className="sheet-handle"
        aria-expanded={snap !== 'closed'}
        aria-controls={bodyId}
        aria-label={HANDLE_LABELS[snap]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false
            return
          }
          setSnap(snapOnTap)
        }}
      >
        <span className="sheet-grip" aria-hidden="true" />
      </button>
      {/* Closed, only the tabs show: a tap on one opens the sheet to show what it picked */}
      <div
        id={bodyId}
        className="sheet-body"
        onClickCapture={() => {
          if (snap === 'closed') setSnap('half')
        }}
        onFocusCapture={(e) => setSnap((current) => snapOnFocus(current, e.target))}
      >
        {children}
      </div>
    </section>
  )
}
