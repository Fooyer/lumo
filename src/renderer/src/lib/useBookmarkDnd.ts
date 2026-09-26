import { useState } from 'react'
import type { DragEvent, HTMLAttributes } from 'react'
import type { Bookmark } from '@shared/ipc'

type Zone = 'before' | 'after' | 'into'

// A drag's payload can't be read while it is still moving over other items, so the item is kept here.
let dragging: Bookmark | null = null

/**
 * Drag and drop for a row of bookmarks and folders (the bar, or the tiles on the home page): dropping on the
 * edge of an item places the dragged one before/after it, and dropping on the middle of a folder puts it inside.
 * `visible` is the row as shown; `parentId` is the folder the row is showing (null for the bar).
 */
export function useBookmarkDnd(visible: Bookmark[], parentId: string | null = null) {
  const [over, setOver] = useState<{ id: string; zone: Zone } | null>(null)

  const zoneOf = (e: DragEvent<HTMLElement>, target: Bookmark): Zone => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    // Only a bookmark can go into a folder (folders don't nest).
    if (target.kind === 'folder' && dragging && dragging.kind !== 'folder' && ratio >= 0.25 && ratio <= 0.75) return 'into'
    return ratio < 0.5 ? 'before' : 'after'
  }

  const itemProps = (b: Bookmark): HTMLAttributes<HTMLElement> => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      dragging = b
      e.dataTransfer.setData('text/plain', b.id)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const zone = zoneOf(e, b)
      setOver((o) => (o?.id === b.id && o.zone === zone ? o : { id: b.id, zone }))
    },
    onDragLeave: () => setOver((o) => (o?.id === b.id ? null : o)),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const moved = dragging
      const zone = zoneOf(e, b)
      setOver(null)
      dragging = null
      if (!moved || moved.id === b.id) return
      if (zone === 'into') {
        window.lumo.moveBookmark(moved.id, b.id)
        return
      }
      const idx = visible.findIndex((x) => x.id === b.id)
      // Next sibling that isn't the dragged item itself, or the end of the row.
      const next = zone === 'after' ? visible.slice(idx + 1).find((x) => x.id !== moved.id) : b
      window.lumo.reorderBookmark(moved.id, next?.id ?? null, parentId)
    },
    onDragEnd: () => {
      setOver(null)
      dragging = null
    }
  })

  /** Dropping on empty space at the end of the row sends the dragged item to its end. */
  const rowProps = {
    onDragOver: (e: DragEvent<HTMLElement>) => e.preventDefault(),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      const moved = dragging
      setOver(null)
      dragging = null
      if (moved) window.lumo.reorderBookmark(moved.id, null, moved.kind === 'folder' ? null : parentId)
    }
  }

  /** Sends what is dragged back to the bar (a "back" button while looking inside a folder). */
  const outProps = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      setOver({ id: 'out', zone: 'into' })
    },
    onDragLeave: () => setOver((o) => (o?.id === 'out' ? null : o)),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const moved = dragging
      setOver(null)
      dragging = null
      if (moved && moved.kind !== 'folder') window.lumo.moveBookmark(moved.id, null)
    }
  }

  const dragClass = (id: string, prefix: string): string => (over?.id === id ? `${prefix}--drag-${over.zone}` : '')

  return { itemProps, rowProps, outProps, dragClass, overOut: over?.id === 'out' }
}
