import { useState } from 'react'
import type { Bookmark } from '@shared/ipc'
import FaviconImg from './FaviconImg'

interface Props {
  bookmarks: Bookmark[]
  totalMemoryMB: number | null
  onNavigate: (input: string) => void
  onOpenNewTab: (url: string) => void
}

type DragZone = 'before' | 'after'

export default function NewTabPage({ bookmarks, totalMemoryMB, onNavigate, onOpenNewTab }: Props): JSX.Element {
  const [value, setValue] = useState('')
  const [dragOver, setDragOver] = useState<{ id: string; zone: DragZone } | null>(null)
  const visible = bookmarks.slice(0, 8)

  return (
    <div className="new-tab">
      <div className="new-tab__glow" />
      <div className="new-tab__logo">Lumo</div>

      <form
        className="new-tab__search"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onNavigate(value.trim())
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Pesquisar ou digitar uma URL…"
        />
      </form>

      {visible.length > 0 && (
        <div className="new-tab__grid">
          {visible.map((b) => (
            <button
              key={b.id}
              draggable
              className={`new-tab__tile ${
                dragOver?.id === b.id ? `new-tab__tile--drag-${dragOver.zone}` : ''
              }`}
              onClick={() => onNavigate(b.url)}
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
                  const idx = visible.findIndex((x) => x.id === b.id)
                  const beforeId = dragOver.zone === 'after' ? visible[idx + 1]?.id ?? null : b.id
                  window.lumo.reorderBookmark(draggedId, beforeId)
                }
                setDragOver(null)
              }}
              onDragEnd={() => setDragOver(null)}
              title={b.url}
            >
              <FaviconImg
                src={b.favicon}
                className="new-tab__tile-icon"
                fallbackClassName="new-tab__tile-dot"
              />
              <span>{b.title || b.url}</span>
            </button>
          ))}
        </div>
      )}

      {totalMemoryMB !== null && <div className="new-tab__stat">{totalMemoryMB} MB de RAM em uso agora</div>}
    </div>
  )
}
