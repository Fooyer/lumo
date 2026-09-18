import { useState } from 'react'
import type { Bookmark } from '@shared/ipc'
import FaviconImg from './FaviconImg'

interface Props {
  bookmarks: Bookmark[]
  onOpen: (url: string) => void
  onOpenNewTab: (url: string) => void
}

type DragZone = 'before' | 'after'

export default function BookmarksBar({ bookmarks, onOpen, onOpenNewTab }: Props): JSX.Element {
  const [dragOver, setDragOver] = useState<{ id: string; zone: DragZone } | null>(null)

  return (
    <div
      className="bookmarks-bar"
      onWheel={(e) => {
        if (e.deltaY !== 0 && e.deltaX === 0) {
          e.currentTarget.scrollLeft += e.deltaY
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const draggedId = e.dataTransfer.getData('text/plain')
        if (draggedId) window.lumo.reorderBookmark(draggedId, null)
        setDragOver(null)
      }}
    >
      {bookmarks.length === 0 ? (
        <span className="bookmarks-bar__hint">
          Clique na estrela da barra de endereço para adicionar favoritos aqui
        </span>
      ) : (
        bookmarks.map((b) => (
          <button
            key={b.id}
            draggable
            className={`bookmark-chip ${dragOver?.id === b.id ? `bookmark-chip--drag-${dragOver.zone}` : ''}`}
            title={b.url}
            onClick={() => onOpen(b.url)}
            onAuxClick={(e) => {
              if (e.button === 1) onOpenNewTab(b.url)
            }}
            onContextMenu={() => window.lumo.showBookmarkContextMenu(b.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', b.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              const ratio = (e.clientX - rect.left) / rect.width
              setDragOver({ id: b.id, zone: ratio < 0.5 ? 'before' : 'after' })
            }}
            onDragLeave={() => setDragOver((d) => (d?.id === b.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const draggedId = e.dataTransfer.getData('text/plain')
              if (draggedId && draggedId !== b.id && dragOver) {
                const idx = bookmarks.findIndex((x) => x.id === b.id)
                const beforeId = dragOver.zone === 'after' ? bookmarks[idx + 1]?.id ?? null : b.id
                window.lumo.reorderBookmark(draggedId, beforeId)
              }
              setDragOver(null)
            }}
            onDragEnd={() => setDragOver(null)}
          >
            <FaviconImg
              src={b.favicon}
              className="bookmark-chip__icon"
              fallbackClassName="bookmark-chip__dot"
            />
            <span>{b.title || b.url}</span>
          </button>
        ))
      )}
    </div>
  )
}
