import { useEffect, useState } from 'react'
import { Download, Folder, ExternalLink, X, Trash2 } from 'lucide-react'
import type { DownloadItem } from '@shared/ipc'
import { lighten } from '../lib/color'
import { downloadEta } from '../lib/downloadEta'

const PAGE_SIZE = 25

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function DownloadsFlyout(): JSX.Element {
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    // Initial fetch
    void window.lumo.listDownloads().then((items) => {
      setDownloads(items)
      setIsLoaded(true)
    })
    void window.lumo.getSettings().then((s) => {
      const root = document.documentElement
      root.style.setProperty('--accent', s.theme.accent)
      root.style.setProperty('--danger', s.theme.danger)
      root.style.setProperty('--bg', s.theme.bg)
      root.style.setProperty('--bg-elevated', lighten(s.theme.bg, 0.05))
      root.style.setProperty('--border', lighten(s.theme.bg, 0.14))
    })
    // Subscribe to live updates
    const unsubscribe = window.lumo.onDownloadsUpdated((items) => {
      setDownloads(items)
      setIsLoaded(true)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const offShow = window.lumo.onDownloadsFlyoutShow(() => {
      void window.lumo.listDownloads().then((items) => {
        setDownloads(items)
        setIsLoaded(true)
      })
      setIsOpen(false)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsOpen(true)
        })
      })
    })

    const offClose = window.lumo.onDownloadsFlyoutClose(() => {
      setIsOpen(false)
    })

    return () => {
      offShow()
      offClose()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        window.lumo.closeDownloadsFlyout()
      }
    }
    const handleBlur = (): void => {
      setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  const hasFinished = downloads.some((d) => d.state === 'completed' || d.state === 'cancelled')
  const visible = downloads.slice(0, visibleCount)

  return (
    <div className="downloads-flyout-wrapper">
      <div className={`downloads-flyout-card ${isOpen ? 'downloads-flyout-card--open' : ''}`}>
        <div className="downloads-flyout-header">
          <div className="downloads-flyout-title-group">
            <span className="downloads-flyout-title">Downloads</span>
            <span className="downloads-flyout-subtitle">
              {!isLoaded
                ? 'Carregando…'
                : downloads.length === 0
                ? 'Nenhum download ainda'
                : `${downloads.length} ${downloads.length === 1 ? 'item' : 'itens'}`}
            </span>
          </div>

          <div className="downloads-flyout-actions">
            {hasFinished && (
              <button
                className="downloads-flyout-btn downloads-flyout-btn--clear"
                onClick={() => window.lumo.clearFinishedDownloads()}
                title="Limpar downloads concluídos"
              >
                <Trash2 size={13} strokeWidth={2.2} />
                <span>Limpar</span>
              </button>
            )}
            <button
              className="downloads-flyout-btn downloads-flyout-btn--close"
              onClick={() => {
                setIsOpen(false)
                window.lumo.closeDownloadsFlyout()
              }}
              title="Fechar"
            >
              <X size={15} strokeWidth={2.4} />
            </button>
          </div>
        </div>

        <div className="downloads-flyout-body">
          {!isLoaded ? null : downloads.length === 0 ? (
            <div className="downloads-flyout-empty">
              <div className="downloads-flyout-empty-icon">
                <Download size={28} strokeWidth={1.8} />
              </div>
              <p>Nenhum download recente</p>
              <span>Arquivos que você baixar aparecerão aqui.</span>
            </div>
          ) : (
            <div className="downloads-flyout-list">
              {visible.map((d) => {
                const pct =
                  d.totalBytes > 0
                    ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100))
                    : 0
                return (
                  <div key={d.id} className="downloads-flyout-item">
                    <div className="downloads-flyout-item-top">
                      <div className="downloads-flyout-item-info">
                        <span className="downloads-flyout-item-name" title={d.filename}>
                          {d.filename}
                        </span>
                        <span className="downloads-flyout-item-meta">
                          {d.state === 'progressing' && (
                            <>
                              <span className="meta-badge meta-badge--active">Baixando</span>
                              <span>
                                {formatBytes(d.receivedBytes)} / {formatBytes(d.totalBytes)} ({pct}%)
                              </span>
                              {downloadEta(d) && <span>· {downloadEta(d)}</span>}
                            </>
                          )}
                          {d.state === 'completed' && (
                            <>
                              <span className="meta-badge meta-badge--done">Concluído</span>
                              <span>{formatBytes(d.receivedBytes)}</span>
                            </>
                          )}
                          {d.state === 'cancelled' && (
                            <span className="meta-badge meta-badge--cancelled">Cancelado</span>
                          )}
                          {d.state === 'interrupted' && (
                            <span className="meta-badge meta-badge--cancelled">Interrompido</span>
                          )}
                        </span>
                      </div>

                      <div className="downloads-flyout-item-actions">
                        {d.state === 'progressing' ? (
                          <button
                            className="downloads-item-btn downloads-item-btn--cancel"
                            onClick={() => window.lumo.cancelDownload(d.id)}
                            title="Cancelar download"
                          >
                            Cancelar
                          </button>
                        ) : (
                          <>
                            <button
                              className="downloads-item-btn downloads-item-btn--open"
                              onClick={() => {
                                window.lumo.openDownload(d.id)
                                window.lumo.closeDownloadsFlyout()
                              }}
                              title="Abrir arquivo"
                            >
                              <ExternalLink size={13} strokeWidth={2.2} />
                              <span>Abrir</span>
                            </button>
                            <button
                              className="downloads-item-btn downloads-item-btn--folder"
                              onClick={() => window.lumo.showDownloadInFolder(d.id)}
                              title="Mostrar na pasta"
                            >
                              <Folder size={13} strokeWidth={2.2} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {d.state === 'progressing' && (
                      <div className="downloads-flyout-bar">
                        <div
                          className="downloads-flyout-bar-fill"
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              {downloads.length > visibleCount && (
                <button
                  className="downloads-flyout-more"
                  onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                >
                  Carregar mais
                </button>
              )}
            </div>
          )}
        </div>

        <div className="settings-flyout-footer">
          <button className="settings-flyout-advanced-btn" onClick={() => window.lumo.openDownloadsPage()}>
            <ExternalLink size={14} strokeWidth={2.2} />
            <span>Ver todos os downloads (Ctrl+J)</span>
          </button>
        </div>
      </div>
    </div>
  )
}
