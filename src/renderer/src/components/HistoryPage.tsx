import { useCallback, useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { HistoryEntry } from '@shared/ipc'
import FaviconImg from './FaviconImg'

const PAGE_SIZE = 200

interface Props {
  onOpen: (url: string) => void
  onOpenNewTab: (url: string) => void
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

export default function HistoryPage({ onOpen, onOpenNewTab }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [items, setItems] = useState<HistoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [confirmingClear, setConfirmingClear] = useState(false)

  // Typing shouldn't query the whole history on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query)
      setLimit(PAGE_SIZE)
    }, 150)
    return () => clearTimeout(t)
  }, [query])

  const refresh = useCallback(() => {
    void window.lumo.listHistory(search, limit).then((result) => {
      setItems(result.items)
      setTotal(result.total)
    })
  }, [search, limit])

  useEffect(refresh, [refresh])
  // Pages visited in other tabs show up here as they happen.
  useEffect(() => {
    const off = window.lumo.onHistoryChanged(refresh)
    return () => {
      off()
    }
  }, [refresh])

  const clearAll = async (): Promise<void> => {
    setConfirmingClear(false)
    await window.lumo.clearHistory()
    refresh()
  }

  const groups: { label: string; entries: HistoryEntry[] }[] = []
  for (const entry of items) {
    const label = dayLabel(entry.visitedAt)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }

  return (
    <div className="history-page">
      <div className="history-page__head">
        <h1>Histórico</h1>
        {confirmingClear ? (
          <div className="history-page__confirm">
            <span>Apagar todo o histórico?</span>
            <button className="history-page__danger" onClick={() => void clearAll()}>
              Apagar
            </button>
            <button onClick={() => setConfirmingClear(false)}>Cancelar</button>
          </div>
        ) : (
          <button
            className="history-page__clear"
            onClick={() => setConfirmingClear(true)}
            disabled={total === 0 && !search}
          >
            Limpar histórico
          </button>
        )}
      </div>

      <label className="history-page__search">
        <Search size={15} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar no histórico"
        />
      </label>

      {groups.length === 0 && (
        <p className="settings-hint history-page__empty">
          {search ? 'Nada encontrado no histórico.' : 'Ainda não há páginas no histórico. Ele fica guardado só neste computador.'}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.label} className="history-day">
          <h2>{group.label}</h2>
          {group.entries.map((entry) => (
            <div key={entry.id} className="history-row">
              <span className="history-row__time">
                {new Date(entry.visitedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <button
                className="history-row__link"
                title={entry.url}
                onClick={() => onOpen(entry.url)}
                onAuxClick={(e) => {
                  if (e.button === 1) onOpenNewTab(entry.url)
                }}
              >
                <FaviconImg src={entry.favicon} className="history-row__icon" fallbackClassName="history-row__dot" />
                <span className="history-row__title">{entry.title || hostOf(entry.url)}</span>
                <span className="history-row__host">{hostOf(entry.url)}</span>
              </button>
              <button
                className="history-row__remove"
                title="Remover do histórico"
                onClick={() => void window.lumo.removeHistoryVisit(entry.id).then(refresh)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </section>
      ))}

      {items.length < total && (
        <button className="history-page__more" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          Mostrar mais ({total - items.length} restantes)
        </button>
      )}
    </div>
  )
}
