import { useEffect, useState } from 'react'
import { Download, ExternalLink, Folder, Search } from 'lucide-react'
import type { DownloadItem } from '@shared/ipc'
import { downloadEta } from '../lib/downloadEta'

interface Props {
  downloads: DownloadItem[]
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function dayLabel(timestamp: number): string {
  const day = new Date(timestamp)
  day.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Hoje'
  if (diffDays === 1) return 'Ontem'
  return day.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const STATE_LABEL: Record<DownloadItem['state'], string> = {
  progressing: 'Baixando',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  interrupted: 'Interrompido'
}

const PAGE_SIZE = 100

/** lumo://downloads (Ctrl+J): the full download history, newest first, grouped by day. */
export default function DownloadsPage({ downloads }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)

  useEffect(() => setLimit(PAGE_SIZE), [query])

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matching = tokens.length
    ? downloads.filter((d) => {
        const hay = `${d.filename} ${d.url}`.toLowerCase()
        return tokens.every((t) => hay.includes(t))
      })
    : downloads
  const visible = matching.slice(0, limit)
  const hasFinished = downloads.some((d) => d.state !== 'progressing')

  const groups: { label: string; entries: DownloadItem[] }[] = []
  for (const d of visible) {
    const label = dayLabel(d.startTime)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.entries.push(d)
    else groups.push({ label, entries: [d] })
  }

  return (
    <div className="history-page">
      <div className="history-page__head">
        <h1>Downloads</h1>
        <button
          className="history-page__clear"
          onClick={() => window.lumo.clearFinishedDownloads()}
          disabled={!hasFinished}
        >
          Limpar concluídos
        </button>
      </div>

      <label className="history-page__search">
        <Search size={15} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar nos downloads"
        />
      </label>

      {groups.length === 0 && (
        <p className="settings-hint history-page__empty">
          {query ? 'Nada encontrado nos downloads.' : 'Nenhum download ainda. Os arquivos que você baixar aparecem aqui.'}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.label} className="history-day">
          <h2>{group.label}</h2>
          {group.entries.map((d) => {
            const pct = d.totalBytes > 0 ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : 0
            return (
              <div key={d.id} className="downloads-row">
                <span className="history-row__time">
                  {new Date(d.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <div className="downloads-row__icon">
                  <Download size={16} strokeWidth={2.2} />
                </div>
                <div className="downloads-row__info">
                  <span className="downloads-row__name" title={d.savePath || d.filename}>
                    {d.filename}
                  </span>
                  <span className="downloads-row__meta">
                    <span className={`meta-badge meta-badge--${d.state === 'progressing' ? 'active' : d.state === 'completed' ? 'done' : 'cancelled'}`}>
                      {STATE_LABEL[d.state]}
                    </span>
                    {d.state === 'progressing'
                      ? [`${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)} (${pct}%)`, downloadEta(d)]
                          .filter(Boolean)
                          .join(' · ')
                      : d.state === 'completed'
                        ? formatBytes(d.receivedBytes)
                        : null}
                    <span className="downloads-row__host">{hostOf(d.url)}</span>
                  </span>
                  {d.state === 'progressing' && (
                    <div className="downloads-flyout-bar">
                      <div className="downloads-flyout-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                  )}
                </div>
                <div className="downloads-row__actions">
                  {d.state === 'progressing' ? (
                    <button className="downloads-item-btn downloads-item-btn--cancel" onClick={() => window.lumo.cancelDownload(d.id)}>
                      Cancelar
                    </button>
                  ) : (
                    d.state === 'completed' && (
                      <>
                        <button className="downloads-item-btn" onClick={() => window.lumo.openDownload(d.id)} title="Abrir arquivo">
                          <ExternalLink size={13} strokeWidth={2.2} />
                          <span>Abrir</span>
                        </button>
                        <button className="downloads-item-btn" onClick={() => window.lumo.showDownloadInFolder(d.id)} title="Mostrar na pasta">
                          <Folder size={13} strokeWidth={2.2} />
                        </button>
                      </>
                    )
                  )}
                </div>
              </div>
            )
          })}
        </section>
      ))}

      {visible.length < matching.length && (
        <button className="history-page__more" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          Mostrar mais ({matching.length - visible.length} restantes)
        </button>
      )}
    </div>
  )
}
