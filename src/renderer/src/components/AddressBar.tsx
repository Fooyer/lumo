import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Star, Code2, Settings as SettingsIcon } from 'lucide-react'
import type { TabSnapshot, AiStatusPayload, DownloadItem, AnchorBounds } from '@shared/ipc'
import DownloadsButton from './DownloadsButton'

interface Props {
  activeTab: TabSnapshot | null
  onNavigate: (input: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onInspect: () => void
  isBookmarked: boolean
  onToggleBookmark: () => void
  aiStatus: AiStatusPayload
  downloads: DownloadItem[]
  downloadsOpen: boolean
  onToggleDownloads: (bounds?: AnchorBounds) => void
  settingsOpen: boolean
  onToggleSettings: (bounds?: AnchorBounds) => void
}

export default function AddressBar({
  activeTab,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onInspect,
  isBookmarked,
  onToggleBookmark,
  aiStatus,
  downloads,
  downloadsOpen,
  onToggleDownloads,
  settingsOpen,
  onToggleSettings
}: Props): JSX.Element {
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const gearBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!editing) setValue(activeTab?.url ?? '')
  }, [activeTab?.url, editing])

  const handleReload = (): void => {
    onReload()
    setSpinning(true)
    setTimeout(() => setSpinning(false), 500)
  }

  const handleSettingsClick = (): void => {
    const rect = gearBtnRef.current?.getBoundingClientRect()
    onToggleSettings(
      rect
        ? {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          }
        : undefined
    )
  }

  return (
    <div className="address-bar">
      <button className="nav-btn nav-btn--back" onClick={onBack} disabled={!activeTab?.canGoBack} title="Voltar">
        <ArrowLeft size={16} strokeWidth={2.4} />
      </button>
      <button
        className="nav-btn nav-btn--forward"
        onClick={onForward}
        disabled={!activeTab?.canGoForward}
        title="Avançar"
      >
        <ArrowRight size={16} strokeWidth={2.4} />
      </button>
      <button
        className={`nav-btn nav-btn--reload ${
          activeTab?.loading ? 'nav-btn--spin-loading' : spinning ? 'nav-btn--spin-once' : ''
        }`}
        onClick={handleReload}
        title="Recarregar"
      >
        <RotateCw size={15} strokeWidth={2.4} />
      </button>

      <form
        className="address-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim()) return
          onNavigate(value.trim())
          setEditing(false)
        }}
      >
        <input
          className="address-input"
          value={value}
          placeholder="Digite uma URL, uma busca ou pergunte algo…"
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => setValue(e.target.value)}
        />
        {aiStatus.busy && <span className="ai-pill">{aiStatus.message ?? 'Pensando…'}</span>}

        <button
          type="button"
          className={`star-btn ${isBookmarked ? 'star-btn--active' : ''}`}
          onClick={onToggleBookmark}
          disabled={!activeTab || activeTab.url.startsWith('lumo://')}
          title={isBookmarked ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          <Star size={15} strokeWidth={2.4} fill={isBookmarked ? 'currentColor' : 'none'} />
        </button>
      </form>

      <div className="address-bar__tools">
        <button className="nav-btn nav-btn--inspect" onClick={onInspect} title="Inspecionar página (F12)">
          <Code2 size={16} strokeWidth={2.2} />
        </button>
        <DownloadsButton downloads={downloads} open={downloadsOpen} onToggle={onToggleDownloads} />
        <button
          ref={gearBtnRef}
          className={`gear-btn ${settingsOpen ? 'gear-btn--active' : ''}`}
          title="Configurações"
          onClick={handleSettingsClick}
        >
          <span className="gear-btn__icon">
            <SettingsIcon size={16} strokeWidth={2.2} />
          </span>
        </button>
      </div>
    </div>
  )
}
