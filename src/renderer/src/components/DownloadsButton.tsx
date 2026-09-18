import { useRef } from 'react'
import { Download } from 'lucide-react'
import type { DownloadItem, AnchorBounds } from '@shared/ipc'

interface Props {
  downloads: DownloadItem[]
  open: boolean
  onToggle: (bounds?: AnchorBounds) => void
}

export default function DownloadsButton({ downloads, open, onToggle }: Props): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null)
  const active = downloads.filter((d) => d.state === 'progressing').length

  const handleClick = (): void => {
    const rect = btnRef.current?.getBoundingClientRect()
    onToggle(
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
    <button
      ref={btnRef}
      className={`downloads__toggle ${open ? 'downloads__toggle--active' : ''}`}
      onClick={handleClick}
      title="Downloads"
    >
      <Download size={16} strokeWidth={2.2} />
      {active > 0 && <span className="downloads__badge">{active}</span>}
    </button>
  )
}
