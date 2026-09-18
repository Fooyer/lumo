import type { Settings } from '@shared/ipc'
import PasswordsSection from './PasswordsSection'

interface Props {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
}

const PRESETS: { name: string; accent: string; danger: string }[] = [
  { name: 'Azul & Vermelho', accent: '#2e6bff', danger: '#ff4d6a' },
  { name: 'Vermelho & Azul', accent: '#ff3b4e', danger: '#2e6bff' },
  { name: 'Roxo & Rosa', accent: '#7c3aed', danger: '#ec4899' },
  { name: 'Verde & Laranja', accent: '#16a34a', danger: '#f97316' },
  { name: 'Ciano & Violeta', accent: '#06b6d4', danger: '#8b5cf6' },
  { name: 'Mono', accent: '#6b7280', danger: '#9ca3af' }
]

export default function SettingsPage({ settings, onChange }: Props): JSX.Element {
  return (
    <div className="settings-page">
      <h1>Configurações</h1>

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

      <PasswordsSection settings={settings} onChange={onChange} />

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
