import { screen, type BrowserWindow } from 'electron'
import type { AnchorBounds } from '../shared/ipc'

const GAP = 4
const MARGIN = 8

/**
 * Screen position for a flyout that opens from a button (`anchor`, in `parent`'s client coordinates).
 * It drops down from the button when there's room and opens upward when the button sits near the
 * bottom of the screen (e.g. in a sidebar footer); it lines up with the button's right edge, or its
 * left edge when the button is on the left half of the window.
 */
export function positionFlyout(
  parent: BrowserWindow,
  anchor: AnchorBounds | undefined,
  size: { width: number; height: number }
): { x: number; y: number } {
  const content = parent.getContentBounds()
  const work = screen.getDisplayMatching(content).workArea

  let x: number
  let y: number
  if (anchor) {
    const left = content.x + anchor.x
    const top = content.y + anchor.y
    const onLeftHalf = left + anchor.width / 2 < content.x + content.width / 2
    x = onLeftHalf ? left : left + anchor.width - size.width
    y = top + anchor.height + GAP
    if (y + size.height > work.y + work.height - MARGIN) y = top - size.height - GAP
  } else {
    x = content.x + content.width - size.width - 12
    y = content.y + 78
  }

  x = Math.min(x, work.x + work.width - size.width - MARGIN)
  x = Math.max(x, work.x + MARGIN)
  y = Math.min(y, work.y + work.height - size.height - MARGIN)
  y = Math.max(y, work.y + MARGIN)
  return { x: Math.round(x), y: Math.round(y) }
}
