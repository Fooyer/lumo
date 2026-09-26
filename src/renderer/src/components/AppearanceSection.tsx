import type { Settings } from '@shared/ipc'
import LayoutPicker from './LayoutPicker'
import { Item, Section } from './SettingsParts'
import ThemeModeToggle from './ThemeModeToggle'

export const PRESETS: { name: string; accent: string; danger: string }[] = [
  { name: 'Azul & Vermelho', accent: '#2e6bff', danger: '#ff4d6a' },
  { name: 'Vermelho & Azul', accent: '#ff3b4e', danger: '#2e6bff' },
  { name: 'Roxo & Rosa', accent: '#7c3aed', danger: '#ec4899' },
  { name: 'Verde & Laranja', accent: '#16a34a', danger: '#f97316' },
  { name: 'Ciano & Violeta', accent: '#06b6d4', danger: '#8b5cf6' },
  { name: 'Mono', accent: '#6b7280', danger: '#9ca3af' }
]

interface Props {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
}

export default function AppearanceSection({ settings, onChange }: Props): JSX.Element {
  const fromMod = settings.themeFromMod === true

  return (
    <Section title="Aparência" hint="Cores, posição das abas e barras. Tudo é aplicado na hora.">
      <Item keywords="tema cores cor destaque fundo claro escuro paleta">
        <h3 className="settings-subtitle">Cores do Lumo</h3>
        {fromMod ? (
          <>
            <p className="settings-hint">
              As cores vêm de um mod (escolhido em "Usar de cada mod"). Para usar as suas, volte para as cores do Lumo.
            </p>
            <button className="restart-btn" onClick={() => onChange({ mods: { ...settings.mods, theme: null } })}>
              Usar as cores do Lumo
            </button>
          </>
        ) : (
          <>
            <p className="settings-hint">
              O texto e os botões se ajustam sozinhos para continuar legíveis, mesmo com um fundo claro.
            </p>
            <ThemeModeToggle theme={settings.theme} onChange={(theme) => onChange({ theme })} />
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
          </>
        )}
      </Item>

      <Item keywords="layout abas posição topo esquerda direita inferior lateral">
        <h3 className="settings-subtitle">Posição das abas</h3>
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
      </Item>

      <Item keywords="barra de endereço ocultar esconder automaticamente">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.autoHideAddressBar}
            onChange={(e) => onChange({ autoHideAddressBar: e.target.checked })}
          />
          Ocultar a barra de endereço automaticamente
        </label>
        <p className="settings-hint">
          Ela aparece, com uma animação, quando você leva o mouse à borda da janela: ao topo (sobre as abas) ou, no
          layout inferior, às abas embaixo. Fica visível enquanto você digita.
        </p>
      </Item>

      <Item keywords="favoritos marcadores barra">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.showBookmarksBar}
            onChange={(e) => onChange({ showBookmarksBar: e.target.checked })}
          />
          Mostrar a barra de favoritos
        </label>
      </Item>
    </Section>
  )
}
