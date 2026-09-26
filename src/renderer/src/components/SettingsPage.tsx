import { useCallback, useEffect, useRef, useState } from 'react'
import { Gauge, Palette, Search, Settings as SettingsIcon, Volume2, Wrench, X } from 'lucide-react'
import type {
  Settings,
  DefaultBrowserStatus,
  UpdateStatus,
  ModInfo
} from '@shared/ipc'
import AppearanceSection from './AppearanceSection'
import ModsSection from './ModsSection'
import SoundsSection from './SoundsSection'
import { Item, Section } from './SettingsParts'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function DefaultBrowserSection(): JSX.Element | null {
  const [status, setStatus] = useState<DefaultBrowserStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    void window.lumo.getDefaultBrowserStatus().then(setStatus)
  }, [])
  // The choice is made in the Windows settings window, so re-check when the user comes back.
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  if (!status?.supported) return null

  const makeDefault = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.lumo.makeDefaultBrowser()
    } finally {
      setBusy(false)
      refresh()
    }
  }

  return (
    <Section title="Navegador padrão">
      <Item keywords="padrão default links windows">
        {status.isDefault ? (
          <p className="settings-hint">O Lumo é o seu navegador padrão. Links de outros programas abrem aqui.</p>
        ) : (
          <>
            <p className="settings-hint">
              O Windows não deixa um programa se definir como padrão sozinho. Ao clicar, o Lumo se registra e abre as
              configurações do Windows: escolha o Lumo em "Navegador da Web".
            </p>
            <button className="restart-btn" onClick={() => void makeDefault()} disabled={busy}>
              Definir como navegador padrão
            </button>
          </>
        )}
      </Item>
    </Section>
  )
}

function CacheSection(): JSX.Element {
  const [size, setSize] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  const refresh = useCallback(() => {
    void window.lumo.getCacheSize().then(setSize)
  }, [])
  useEffect(refresh, [refresh])

  const clear = async (): Promise<void> => {
    setClearing(true)
    try {
      await window.lumo.clearCache()
    } finally {
      setClearing(false)
      refresh()
    }
  }

  return (
    <Section title="Cache">
      <Item keywords="limpar cache arquivos sites espaço disco">
        <p className="settings-hint">
          Arquivos de sites (CSS, scripts, imagens) ficam guardados para carregar mais rápido. Atalhos: F5 recarrega,
          Ctrl+F5 recarrega ignorando o cache.
          {size !== null && ` Tamanho atual: ${formatBytes(size)}.`}
        </p>
        <button className="restart-btn" onClick={() => void clear()} disabled={clearing}>
          {clearing ? 'Limpando…' : 'Limpar cache'}
        </button>
      </Item>
    </Section>
  )
}

function updateMessage(status: UpdateStatus): string {
  switch (status.state) {
    case 'unsupported':
      return 'As atualizações só funcionam na versão instalada do Lumo.'
    case 'checking':
      return 'Procurando atualizações…'
    case 'downloading':
      return `Baixando a versão ${status.version ?? ''}… ${status.percent ?? 0}%`
    case 'ready':
      return `A versão ${status.version} foi baixada e está pronta para instalar.`
    case 'up-to-date':
      return 'Você está usando a versão mais recente.'
    case 'error':
      return `Não foi possível verificar agora. ${status.error ?? ''}`.trim()
    default:
      return 'Ainda não verificado nesta sessão.'
  }
}

function UpdatesSection({
  settings,
  onChange
}: {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
}): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    void window.lumo.getUpdateStatus().then(setStatus)
    const off = window.lumo.onUpdateStatus(setStatus)
    return () => {
      off()
    }
  }, [])

  const busy = status?.state === 'checking' || status?.state === 'downloading'

  return (
    <Section title="Atualizações">
      <Item keywords="atualizar versão novidades baixar instalar">
        <p className="settings-hint">
          Versão instalada: {status?.currentVersion ?? '…'}
          {status && ` — ${updateMessage(status)}`}
        </p>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.autoUpdate}
            onChange={(e) => onChange({ autoUpdate: e.target.checked })}
          />
          Procurar atualizações automaticamente
        </label>
        {status?.state === 'ready' ? (
          <button className="restart-btn" onClick={() => window.lumo.installUpdate()}>
            Reiniciar e instalar
          </button>
        ) : (
          <button
            className="restart-btn"
            onClick={() => void window.lumo.checkForUpdates().then(setStatus)}
            disabled={busy || status?.state === 'unsupported'}
          >
            {busy ? 'Aguarde…' : 'Verificar atualizações'}
          </button>
        )}
      </Item>
    </Section>
  )
}

const CATEGORIES = [
  { id: 'general', label: 'Geral', icon: SettingsIcon },
  { id: 'personalization', label: 'Personalização', icon: Palette },
  { id: 'sounds', label: 'Sons e música', icon: Volume2 },
  { id: 'performance', label: 'Desempenho', icon: Gauge },
  { id: 'system', label: 'Sistema', icon: Wrench }
] as const

type CategoryId = (typeof CATEGORIES)[number]['id']

/** Lowercase and accent-free, so "musica" finds "música". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

interface Props {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
}

export default function SettingsPage({ settings, onChange }: Props): JSX.Element {
  const [category, setCategory] = useState<CategoryId>('general')
  const [query, setQuery] = useState('')
  const [noResults, setNoResults] = useState(false)
  const [mods, setMods] = useState<ModInfo[]>([])
  const contentRef = useRef<HTMLDivElement>(null)

  const refreshMods = useCallback(async () => setMods(await window.lumo.listMods()), [])
  useEffect(() => {
    void refreshMods()
  }, [refreshMods])
  // A mod removed or installed elsewhere (the store banner) changes the list; the settings broadcast is the cue.
  useEffect(() => {
    void refreshMods()
  }, [settings.mods, refreshMods])

  // Searching shows every category and hides what doesn't match. It works on the DOM (each searchable block is a
  // `.settings-item` inside a `.settings-section`) so a setting is found by its label, its hint and its keywords.
  // It runs after every render, so parts that appear later (an update status, the RAM list) are filtered too.
  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    const words = normalize(query).split(/\s+/).filter(Boolean)
    let visibleSections = 0
    root.querySelectorAll<HTMLElement>('.settings-section').forEach((section) => {
      const title = section.dataset.title ?? ''
      let any = false
      section.querySelectorAll<HTMLElement>('.settings-item').forEach((item) => {
        const haystack = normalize(`${title} ${item.dataset.keywords ?? ''} ${item.textContent ?? ''}`)
        const hit = words.every((w) => haystack.includes(w))
        item.hidden = !hit
        if (hit) any = true
      })
      section.hidden = !any
      if (any) visibleSections++
    })
    root.querySelectorAll<HTMLElement>('.settings-category').forEach((cat) => {
      cat.dataset.empty = String(!cat.querySelector('.settings-section:not([hidden])'))
    })
    const none = words.length > 0 && visibleSections === 0
    setNoResults((prev) => (prev === none ? prev : none))
  })

  const searching = query.trim() !== ''

  const categoryBody = (id: CategoryId): JSX.Element => {
    switch (id) {
      case 'general':
        return (
          <>
            <DefaultBrowserSection />
            <Section title="Sessão">
              <Item keywords="restaurar abas abertas iniciar reabrir">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.restoreSession}
                    onChange={(e) => onChange({ restoreSession: e.target.checked })}
                  />
                  Restaurar as abas abertas ao iniciar o Lumo
                </label>
                <p className="settings-hint">
                  As abas são salvas automaticamente. Ao reabrir, só a aba ativa carrega; as outras carregam quando você
                  clicar nelas.
                </p>
              </Item>
            </Section>
            <UpdatesSection settings={settings} onChange={onChange} />
          </>
        )
      case 'personalization':
        return (
          <>
            <AppearanceSection settings={settings} onChange={onChange} />
            <ModsSection settings={settings} onChange={onChange} mods={mods} refreshMods={refreshMods} />
          </>
        )
      case 'sounds':
        return <SoundsSection settings={settings} onChange={onChange} mods={mods} />
      case 'performance':
        return (
          <>
            <Section title="Economia de memória">
              <Item keywords="suspender abas ociosas inativas ram">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.memorySaverEnabled}
                    onChange={(e) => onChange({ memorySaverEnabled: e.target.checked })}
                  />
                  Suspender abas ociosas automaticamente
                </label>
              </Item>
              <Item keywords="minutos tempo ocioso suspender">
                <label className="settings-number">
                  <span>Suspender após (minutos sem uso)</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={settings.idleSuspendMinutes}
                    onChange={(e) => onChange({ idleSuspendMinutes: Number(e.target.value) || 1 })}
                  />
                </label>
              </Item>
              <Item keywords="limite memória aba mb orçamento">
                <label className="settings-number">
                  <span>Limite de memória por aba (MB)</span>
                  <input
                    type="number"
                    min={100}
                    max={4000}
                    step={50}
                    value={settings.tabMemoryBudgetMB}
                    onChange={(e) => onChange({ tabMemoryBudgetMB: Number(e.target.value) || 100 })}
                  />
                </label>
              </Item>
            </Section>
            <CacheSection />
          </>
        )
      case 'system':
        return (
          <Section title="Sistema">
            <Item keywords="aceleração hardware gpu placa de vídeo reiniciar">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.hardwareAccelerationEnabled}
                  onChange={(e) => onChange({ hardwareAccelerationEnabled: e.target.checked })}
                />
                Usar aceleração de hardware (GPU)
              </label>
              <p className="settings-hint">Precisa reiniciar o Lumo para ter efeito.</p>
              <button className="restart-btn" onClick={() => window.lumo.relaunchApp()}>
                Reiniciar o Lumo
              </button>
            </Item>
          </Section>
        )
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Configurações</h1>
        <label className="settings-search">
          <Search size={15} strokeWidth={2.4} aria-hidden="true" />
          <input
            type="text"
            value={query}
            placeholder="Pesquisar nas configurações…"
            aria-label="Pesquisar nas configurações"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
          />
          {query && (
            <button type="button" className="settings-search__clear" title="Limpar pesquisa" onClick={() => setQuery('')}>
              <X size={14} strokeWidth={2.4} />
            </button>
          )}
        </label>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Categorias">
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`settings-nav__item ${!searching && category === id ? 'settings-nav__item--active' : ''}`}
              onClick={() => {
                setQuery('')
                setCategory(id)
              }}
            >
              <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content" ref={contentRef}>
          {CATEGORIES.map(({ id, label }) => (
            <div key={id} className="settings-category" hidden={!searching && category !== id}>
              {searching && <h3 className="settings-category__title">{label}</h3>}
              {categoryBody(id)}
            </div>
          ))}
          {noResults && <p className="settings-empty">Nenhuma configuração encontrada para "{query.trim()}".</p>}
        </div>
      </div>
    </div>
  )
}
