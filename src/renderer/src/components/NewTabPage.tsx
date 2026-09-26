import { useRef, useState } from 'react'
import { ArrowLeft, FolderClosed, FolderPlus, ShieldCheck, VenetianMask } from 'lucide-react'
import type { Bookmark, ModWallpaper } from '@shared/ipc'
import FaviconImg from './FaviconImg'
import { useSuggestions } from '../lib/useSuggestions'
import { useBookmarkDnd } from '../lib/useBookmarkDnd'

interface Props {
  bookmarks: Bookmark[]
  wallpaper: ModWallpaper | null
  /** A private tab: shows what is and isn't kept, and doesn't suggest pages from the history. */
  incognito: boolean
  onNavigate: (input: string) => void
  onOpenNewTab: (url: string) => void
  onNewFolder: () => void
}

// The home page shows this many favorites (and folders); the rest are one click away in a folder.
const HOME_LIMIT = 12

export default function NewTabPage({ bookmarks, wallpaper, incognito, onNavigate, onOpenNewTab, onNewFolder }: Props): JSX.Element {
  const [value, setValue] = useState('')
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
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
  // Looking inside a folder replaces the grid with what it holds; a folder removed meanwhile just closes.
  const openFolder = bookmarks.find((b) => b.id === openFolderId && b.kind === 'folder') ?? null
  const visible = openFolder
    ? bookmarks.filter((b) => b.parentId === openFolder.id)
    : bookmarks.filter((b) => !b.parentId).slice(0, HOME_LIMIT)
  const dnd = useBookmarkDnd(visible, openFolder?.id ?? null)
  const countIn = (folderId: string): number => bookmarks.filter((b) => b.parentId === folderId).length

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


      {!incognito && openFolder && (
        <div className="new-tab__folder-head">
          <button
            className={`new-tab__back ${dnd.overOut ? 'new-tab__back--drop' : ''}`}
            title="Voltar aos favoritos (solte aqui para tirar da pasta)"
            onClick={() => setOpenFolderId(null)}
            {...dnd.outProps}
          >
            <ArrowLeft size={14} strokeWidth={2.4} /> Favoritos
          </button>
          <span className="new-tab__folder-name">{openFolder.title}</span>
        </div>
      )}

      {(visible.length > 0 || openFolder || (!incognito && bookmarks.length > 0)) && (
        <div
          className="new-tab__grid"
          onContextMenu={(e) => {
            if (!(e.target as HTMLElement).closest('.new-tab__tile')) window.lumo.showBookmarksAreaMenu()
          }}
          {...dnd.rowProps}
        >
          {visible.map((b) =>
            b.kind === 'folder' ? (
              <button
                key={b.id}
                className={`new-tab__tile new-tab__tile--folder ${dnd.dragClass(b.id, 'new-tab__tile')}`}
                onClick={() => setOpenFolderId(b.id)}
                onContextMenu={() => window.lumo.showBookmarkContextMenu(b.id)}
                title={b.title}
                {...dnd.itemProps(b)}
              >
                <FolderClosed size={22} strokeWidth={1.9} className="new-tab__tile-folder" />
                <span>{b.title}</span>
                <small>
                  {countIn(b.id)} {countIn(b.id) === 1 ? 'item' : 'itens'}
                </small>
              </button>
            ) : (
              <button
                key={b.id}
                className={`new-tab__tile ${dnd.dragClass(b.id, 'new-tab__tile')}`}
                onClick={() => onNavigate(b.url)}
                onAuxClick={(e) => {
                  if (e.button === 1) onOpenNewTab(b.url)
                }}
                onContextMenu={() => window.lumo.showBookmarkContextMenu(b.id)}
                title={b.url}
                {...dnd.itemProps(b)}
              >
                <FaviconImg src={b.favicon} className="new-tab__tile-icon" fallbackClassName="new-tab__tile-dot" />
                <span>{b.title || b.url}</span>
              </button>
            )
          )}
          {!incognito && !openFolder && visible.length < HOME_LIMIT && (
            <button
              className="new-tab__tile new-tab__tile--add"
              title="Criar uma pasta de favoritos"
              onClick={onNewFolder}
            >
              <FolderPlus size={20} strokeWidth={1.9} />
              <span>Nova pasta</span>
            </button>
          )}
          {openFolder && visible.length === 0 && (
            <p className="new-tab__folder-empty">
              Pasta vazia. Arraste favoritos para cá, ou use o botão direito num favorito › Mover para a pasta.
            </p>
          )}
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

    </div>
  )
}
