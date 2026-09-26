import { ChevronDown, Folder } from 'lucide-react'
import type { Bookmark } from '@shared/ipc'
import FaviconImg from './FaviconImg'
import { useBookmarkDnd } from '../lib/useBookmarkDnd'

interface Props {
  bookmarks: Bookmark[]
  onOpen: (url: string) => void
  onOpenNewTab: (url: string) => void
}

export default function BookmarksBar({ bookmarks, onOpen, onOpenNewTab }: Props): JSX.Element {
  // What is inside a folder is reached by opening the folder; the bar shows the top level only.
  const onBar = bookmarks.filter((b) => !b.parentId)
  const dnd = useBookmarkDnd(onBar)

  return (
    <div
      className="bookmarks-bar"
      onWheel={(e) => {
        if (e.deltaY !== 0 && e.deltaX === 0) {
          e.currentTarget.scrollLeft += e.deltaY
        }
      }}
      onContextMenu={(e) => {
        if (!(e.target as HTMLElement).closest('.bookmark-chip')) window.lumo.showBookmarksAreaMenu()
      }}
      {...dnd.rowProps}
    >
      {onBar.length === 0 ? (
        <span className="bookmarks-bar__hint">
          Clique na estrela da barra de endereço para adicionar favoritos aqui · botão direito para criar uma pasta
        </span>
      ) : (
        onBar.map((b) =>
          b.kind === 'folder' ? (
            <button
              key={b.id}
              className={`bookmark-chip bookmark-chip--folder ${dnd.dragClass(b.id, 'bookmark-chip')}`}
              title={b.title}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                window.lumo.openBookmarkFolder(b.id, { x: r.x, y: r.y, width: r.width, height: r.height })
              }}
              onContextMenu={() => window.lumo.showBookmarkContextMenu(b.id)}
              {...dnd.itemProps(b)}
            >
              <Folder size={13} strokeWidth={2.2} className="bookmark-chip__folder" />
              <span className="bookmark-chip__label">{b.title}</span>
              <ChevronDown size={11} strokeWidth={2.6} className="bookmark-chip__chevron" />
            </button>
          ) : (
            <button
              key={b.id}
              className={`bookmark-chip ${dnd.dragClass(b.id, 'bookmark-chip')}`}
              title={b.url}
              onClick={() => onOpen(b.url)}
              onAuxClick={(e) => {
                if (e.button === 1) onOpenNewTab(b.url)
              }}
              onContextMenu={() => window.lumo.showBookmarkContextMenu(b.id)}
              {...dnd.itemProps(b)}
            >
              <FaviconImg
                src={b.favicon}
                className="bookmark-chip__icon"
                fallbackClassName="bookmark-chip__dot"
              />
              <span className="bookmark-chip__label">{b.title || b.url}</span>
            </button>
          )
        )
      )}
    </div>
  )
}
