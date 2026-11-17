import { useEffect, useState, type RefObject } from 'react'

/**
 * How much of the bottom of `el` the phone's bottom sheet covers, in px, so the DrawBar can sit just
 * above it instead of under it. The sheet lies over the view (see Editor and BottomSheet) and changes
 * height when it is opened, closed or dragged, so it is measured as it goes. 0 without a sheet
 * (desktop, tablet, the compare view). `watch` finds the sheet again when it may have come or gone.
 */
export function useSheetCover(el: RefObject<HTMLElement | null>, watch: unknown): number {
  const [cover, setCover] = useState(0)
  useEffect(() => {
    const box = el.current
    const sheet = box?.closest('.views')?.querySelector<HTMLElement>(':scope > .sheet')
    if (!box || !sheet || typeof ResizeObserver === 'undefined') {
      setCover(0)
      return
    }
    const measure = () => setCover(Math.max(0, box.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(sheet)
    ro.observe(box)
    return () => ro.disconnect()
  }, [el, watch])
  return cover
}
