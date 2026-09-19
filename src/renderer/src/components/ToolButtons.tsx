import { useRef } from 'react'
import { Code2, Settings as SettingsIcon } from 'lucide-react'
import type { DownloadItem, AnchorBounds } from '@shared/ipc'
import DownloadsButton from './DownloadsButton'

interface Props {
  onInspect: () => void
  downloads: DownloadItem[]
  downloadsOpen: boolean
  onToggleDownloads: (bounds?: AnchorBounds) => void
  settingsOpen: boolean
  onToggleSettings: (bounds?: AnchorBounds) => void
}

/** Dev tools, downloads and settings. Placed in the address bar or the sidebar footer depending on the tab layout. */
export default function ToolButtons({
  onInspect,
  downloads,
  downloadsOpen,
  onToggleDownloads,
  settingsOpen,
  onToggleSettings
}: Props): JSX.Element {
  const gearBtnRef = useRef<HTMLButtonElement>(null)

  const handleSettingsClick = (): void => {
    const rect = gearBtnRef.current?.getBoundingClientRect()
    onToggleSettings(rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined)
  }

  return (
    <>
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
    </>
  )
}
