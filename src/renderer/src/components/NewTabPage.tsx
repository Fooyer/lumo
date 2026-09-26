import { useRef, useState } from 'react'
import { ShieldCheck, VenetianMask } from 'lucide-react'
import type { Bookmark, ModWallpaper } from '@shared/ipc'
import FaviconImg from './FaviconImg'
import { useSuggestions } from '../lib/useSuggestions'

interface Props {
  bookmarks: Bookmark[]
  totalMemoryMB: number | null
  wallpaper: ModWallpaper | null
  /** A private tab: shows what is and isn't kept, and doesn't suggest pages from the history. */
  incognito: boolean
  onNavigate: (input: string) => void
  onOpenNewTab: (url: string) => void
}

type DragZone = 'before' | 'after'

export default function NewTabPage({ bookmarks, totalMemoryMB, wallpaper, incognito, onNavigate, onOpenNewTab }: Props): JSX.Element {
  const [value, setValue] = useState('')
  const [dragOver, setDragOver] = useState<{ id: string; zone: DragZone } | null>(null)
  const [focused, setFocused] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestions = useSuggestions({
    value,
    setValue,
    inputRef,
    enabled: focused && !incognito,
    anchorRef: formRef,
    owner: 'new-tab',
    onPick: onNavigate
  })
  const visible = bookmarks.slice(0, 8)

  return (
    <div className={`new-tab ${wallpaper ? 'new-tab--wallpaper' : ''} ${incognito ? 'new-tab--incognito' : ''}`}>
      {wallpaper &&
        (wallpaper.video ? (
          <video
            className="new-tab__wallpaper"
            src={wallpaper.url}
            poster={wallpaper.poster ?? undefined}
            autoPlay
            loop
            muted
            playsInline
          />
        ) : (
          <img className="new-tab__wallpaper" src={wallpaper.url} alt="" />
        ))}
      <div className="new-tab__glow" />
      {incognito ? (
        <div className="new-tab__private-head">
          <VenetianMask size={44} strokeWidth={1.8} aria-hidden="true" />
          <div className="new-tab__logo">Navegação anônima</div>
        </div>
      ) : (
        <div className="new-tab__logo">Lumo</div>
      )}

      <form
        ref={formRef}
        className="new-tab__search"
        onSubmit={(e) => {
          e.preventDefault()
          const target = suggestions.selected?.url ?? value.trim()
          if (target) onNavigate(target)
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={suggestions.onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={suggestions.onKeyDown}
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

      {incognito && (
        <div className="private-info">
          <div className="private-info__col">
            <h3>
              <ShieldCheck size={14} strokeWidth={2.4} aria-hidden="true" /> O Lumo não guarda
            </h3>
            <ul>
              <li>Histórico de navegação e o que você digita na busca</li>
              <li>Cookies, cache e dados dos sites (apagados ao fechar a última aba anônima)</li>
              <li>Estas abas ao reabrir o Lumo</li>
              <li>Cookies de terceiros e o endereço completo da página para anúncios e rastreadores</li>
            </ul>
          </div>
          <div className="private-info__col">
            <h3>O que continua visível</h3>
            <ul>
              <li>Os sites que você visita, seu provedor de internet e a rede (ou a escola/empresa)</li>
              <li>Arquivos que você baixa continuam na pasta escolhida</li>
              <li>Quem você é, se entrar numa conta dentro do site</li>
            </ul>
          </div>
        </div>
      )}

      {!incognito && totalMemoryMB !== null && <div className="new-tab__stat">{totalMemoryMB} MB de RAM em uso agora</div>}
    </div>
  )
}
