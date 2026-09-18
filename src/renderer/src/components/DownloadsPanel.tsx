import { useState } from 'react'
import type { DownloadItem } from '@shared/ipc'

interface Props {
  open: boolean
  downloads: DownloadItem[]
  onDismiss: () => void
}

const PAGE_SIZE = 20

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function DownloadsPanel({ open, downloads, onDismiss }: Props): JSX.Element {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const visible = downloads.slice(0, visibleCount)

  return (
    <div className={`manager-panel ${open ? 'manager-panel--open' : ''}`}>
      <div className="manager-panel__header">
        <div>
          <strong>Downloads</strong>
          <span className="manager-panel__total">
            {downloads.length === 0 ? 'Nenhum download ainda' : `${downloads.length} no histórico`}
          </span>
        </div>
        <div className="manager-panel__actions">
          <button onClick={() => window.lumo.clearFinishedDownloads()}>Limpar concluídos</button>
          <button className="manager-panel__close" onClick={onDismiss}>
            Fechar
          </button>
        </div>
      </div>

      <div className="manager-panel__groups">
        {downloads.length === 0 ? (
          <div className="downloads__empty">Nenhum download ainda.</div>
        ) : (
          <>
            {visible.map((d) => {
              const pct = d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : 0
              return (
                <div key={d.id} className="download-row">
                  <div className="download-row__info">
                    <span className="download-row__name" title={d.filename}>
                      {d.filename}
                    </span>
                    <span className="download-row__meta">
                      {d.state === 'progressing' &&
                        `${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)}`}
                      {d.state === 'completed' && `Concluído · ${formatBytes(d.receivedBytes)}`}
                      {d.state === 'cancelled' && 'Cancelado'}
                      {d.state === 'interrupted' && 'Interrompido'}
                    </span>
                  </div>
                  {d.state === 'progressing' && (
                    <div className="download-row__bar">
                      <div className="download-row__bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <div className="download-row__actions">
                    {d.state === 'progressing' ? (
                      <button onClick={() => window.lumo.cancelDownload(d.id)}>Cancelar</button>
                    ) : (
                      <>
                        <button onClick={() => window.lumo.openDownload(d.id)}>Abrir</button>
                        <button onClick={() => window.lumo.showDownloadInFolder(d.id)}>Pasta</button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {downloads.length > visibleCount && (
              <button className="downloads__more" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                Carregar mais
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
