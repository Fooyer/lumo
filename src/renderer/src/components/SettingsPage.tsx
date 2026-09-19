import { useCallback, useEffect, useState } from 'react'
import type { Settings, MemorySnapshot, TabSnapshot, DefaultBrowserStatus, UpdateStatus } from '@shared/ipc'
import LayoutPicker from './LayoutPicker'

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
    <section className="settings-section">
      <h2>Navegador padrão</h2>
      {status.isDefault ? (
        <p className="settings-hint">O Lumo é o seu navegador padrão. Links de outros programas abrem aqui.</p>
      ) : (
        <>
          <p className="settings-hint">
            O Windows não deixa um programa se definir como padrão sozinho. Ao clicar, o Lumo se registra e abre
            as configurações do Windows: escolha o Lumo em "Navegador da Web".
          </p>
          <button className="restart-btn" onClick={() => void makeDefault()} disabled={busy}>
            Definir como navegador padrão
          </button>
        </>
      )}
    </section>
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
    <section className="settings-section">
      <h2>Cache</h2>
      <p className="settings-hint">
        Arquivos de sites (CSS, scripts, imagens) ficam guardados para carregar mais rápido.
        Atalhos: F5 recarrega, Ctrl+F5 recarrega ignorando o cache.
        {size !== null && ` Tamanho atual: ${formatBytes(size)}.`}
      </p>
      <button className="restart-btn" onClick={() => void clear()} disabled={clearing}>
        {clearing ? 'Limpando…' : 'Limpar cache'}
      </button>
    </section>
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
    <section className="settings-section">
      <h2>Atualizações</h2>
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
    </section>
  )
}

interface Props {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
  memory: MemorySnapshot | null
  tabs: TabSnapshot[]
}

function MemorySection({ memory, tabs }: { memory: MemorySnapshot | null; tabs: TabSnapshot[] }): JSX.Element {
  const usage = new Map((memory?.tabs ?? []).map((t) => [t.id, t.memoryMB]))
  const rows = tabs
    .filter((t) => usage.has(t.id))
    .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0))

  return (
    <section className="settings-section">
      <h2>Uso de RAM</h2>
      <p className="settings-hint">
        {memory ? `${memory.totalMB} MB em uso agora pelo Lumo (todas as abas e processos do app).` : 'Medindo uso de memória…'}
      </p>
      {rows.length > 0 && (
        <div className="ram-list">
          {rows.map((t) => (
            <div key={t.id} className="ram-row">
              <span className="ram-row__title">{t.title || t.domain}</span>
              <span className="ram-row__mb">{usage.get(t.id)} MB</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const PRESETS: { name: string; accent: string; danger: string }[] = [
  { name: 'Azul & Vermelho', accent: '#2e6bff', danger: '#ff4d6a' },
  { name: 'Vermelho & Azul', accent: '#ff3b4e', danger: '#2e6bff' },
  { name: 'Roxo & Rosa', accent: '#7c3aed', danger: '#ec4899' },
  { name: 'Verde & Laranja', accent: '#16a34a', danger: '#f97316' },
  { name: 'Ciano & Violeta', accent: '#06b6d4', danger: '#8b5cf6' },
  { name: 'Mono', accent: '#6b7280', danger: '#9ca3af' }
]

export default function SettingsPage({ settings, onChange, memory, tabs }: Props): JSX.Element {
  return (
    <div className="settings-page">
      <h1>Configurações</h1>

      <DefaultBrowserSection />

      <section className="settings-section">
        <h2>Aparência</h2>
        <p className="settings-hint">Escolha as cores de destaque do Lumo.</p>

        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              className="preset-swatch"
              title={p.name}
              onClick={() => onChange({ theme: { ...settings.theme, accent: p.accent, danger: p.danger } })}
            >
              <span style={{ background: p.accent }} />
              <span style={{ background: p.danger }} />
            </button>
          ))}
        </div>

        <div className="color-field-row">
          <label className="color-field">
            <span>Cor de destaque</span>
            <input
              type="color"
              value={settings.theme.accent}
              onChange={(e) => onChange({ theme: { ...settings.theme, accent: e.target.value } })}
            />
          </label>
          <label className="color-field">
            <span>Cor secundária</span>
            <input
              type="color"
              value={settings.theme.danger}
              onChange={(e) => onChange({ theme: { ...settings.theme, danger: e.target.value } })}
            />
          </label>
          <label className="color-field">
            <span>Fundo</span>
            <input
              type="color"
              value={settings.theme.bg}
              onChange={(e) => onChange({ theme: { ...settings.theme, bg: e.target.value } })}
            />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h2>Layout</h2>
        <p className="settings-hint">Onde ficam as abas. A mudança é aplicada na hora.</p>
        <LayoutPicker value={settings.tabLayout} onChange={(tabLayout) => onChange({ tabLayout })} />
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.sidebarCollapsed}
            disabled={settings.tabLayout !== 'left' && settings.tabLayout !== 'right'}
            onChange={(e) => onChange({ sidebarCollapsed: e.target.checked })}
          />
          Barra lateral compacta (só ícones)
        </label>
      </section>

      <section className="settings-section">
        <h2>Sessão</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.restoreSession}
            onChange={(e) => onChange({ restoreSession: e.target.checked })}
          />
          Restaurar as abas abertas ao iniciar o Lumo
        </label>
        <p className="settings-hint">
          As abas são salvas automaticamente. Ao reabrir, só a aba ativa carrega; as outras carregam
          quando você clicar nelas.
        </p>
      </section>

      <section className="settings-section">
        <h2>Favoritos</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.showBookmarksBar}
            onChange={(e) => onChange({ showBookmarksBar: e.target.checked })}
          />
          Mostrar barra de favoritos
        </label>
      </section>

      <MemorySection memory={memory} tabs={tabs} />

      <section className="settings-section">
        <h2>Desempenho &amp; memória</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.memorySaverEnabled}
            onChange={(e) => onChange({ memorySaverEnabled: e.target.checked })}
          />
          Suspender abas ociosas automaticamente
        </label>

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
      </section>

      <CacheSection />

      <UpdatesSection settings={settings} onChange={onChange} />

      <section className="settings-section">
        <h2>Sistema</h2>
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
      </section>
    </div>
  )
}
