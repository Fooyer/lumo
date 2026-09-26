import { useEffect, useState } from 'react'
import {
  X,
  Bookmark,
  Cpu,
  History,
  LayoutPanelLeft,
  SlidersHorizontal,
  Palette,
  Store
} from 'lucide-react'
import type { Settings } from '@shared/ipc'
import { applyTheme } from '../lib/useTheme'
import LayoutPicker from './LayoutPicker'

const PRESETS: { name: string; accent: string; danger: string }[] = [
  { name: 'Azul & Vermelho', accent: '#2e6bff', danger: '#ff4d6a' },
  { name: 'Vermelho & Azul', accent: '#ff3b4e', danger: '#2e6bff' },
  { name: 'Roxo & Rosa', accent: '#7c3aed', danger: '#ec4899' },
  { name: 'Verde & Laranja', accent: '#16a34a', danger: '#f97316' },
  { name: 'Ciano & Violeta', accent: '#06b6d4', danger: '#8b5cf6' },
  { name: 'Mono', accent: '#6b7280', danger: '#9ca3af' }
]

export default function SettingsFlyout(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const applyThemeVars = (s: Settings): void => applyTheme(s.theme)

  useEffect(() => {
    void window.lumo.getSettings().then((s) => {
      setSettings(s)
      applyThemeVars(s)
    })
  }, [])

  useEffect(() => {
    const offShow = window.lumo.onSettingsFlyoutShow(() => {
      void window.lumo.getSettings().then((s) => {
        setSettings(s)
        applyThemeVars(s)
      })
      setIsOpen(false)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsOpen(true)
        })
      })
    })

    const offClose = window.lumo.onSettingsFlyoutClose(() => {
      setIsOpen(false)
    })

    const offChanged = window.lumo.onSettingsChanged((s) => {
      setSettings(s)
      applyThemeVars(s)
    })

    return () => {
      offShow()
      offClose()
      offChanged()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        window.lumo.closeSettingsFlyout()
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

  const handleUpdate = (partial: Partial<Settings>): void => {
    if (!settings) return
    const optimistic = { ...settings, ...partial }
    setSettings(optimistic)
    if (partial.theme) {
      applyThemeVars(optimistic)
    }
    void window.lumo.setSettings(partial).then((updated) => {
      setSettings(updated)
      applyThemeVars(updated)
    })
  }

  const handleOpenAdvanced = (): void => {
    setIsOpen(false)
    window.lumo.openFullSettings()
  }

  return (
    <div className="settings-flyout-wrapper">
      <div className={`settings-flyout-card ${isOpen ? 'settings-flyout-card--open' : ''}`}>
        <div className="settings-flyout-header">
          <div className="settings-flyout-title-group">
            <span className="settings-flyout-title">Configurações</span>
            <span className="settings-flyout-subtitle">Ajustes rápidos</span>
          </div>
          <button
            className="settings-flyout-btn-close"
            onClick={() => {
              setIsOpen(false)
              window.lumo.closeSettingsFlyout()
            }}
            title="Fechar"
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="settings-flyout-body">
          {/* Aparência / Tema */}
          <div className="settings-flyout-group">
            <div className="settings-flyout-group-title">
              <Palette size={13} strokeWidth={2.4} />
              <span>Tema e cores</span>
            </div>
            <div className="settings-flyout-presets">
              {PRESETS.map((p) => {
                const isActive =
                  settings?.theme.accent.toLowerCase() === p.accent.toLowerCase() &&
                  settings?.theme.danger.toLowerCase() === p.danger.toLowerCase()
                return (
                  <button
                    key={p.name}
                    className={`settings-flyout-swatch ${isActive ? 'settings-flyout-swatch--active' : ''}`}
                    title={settings?.themeFromMod ? 'As cores vêm do mod ativo' : p.name}
                    disabled={settings?.themeFromMod}
                    onClick={() =>
                      handleUpdate({
                        theme: {
                          accent: p.accent,
                          danger: p.danger,
                          bg: settings?.theme.bg ?? '#0f1117'
                        }
                      })
                    }
                  >
                    <span style={{ background: p.accent }} />
                    <span style={{ background: p.danger }} />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Layout das abas */}
          <div className="settings-flyout-group">
            <div className="settings-flyout-group-title">
              <LayoutPanelLeft size={13} strokeWidth={2.4} />
              <span>Layout das abas</span>
            </div>
            <LayoutPicker
              value={settings?.tabLayout ?? 'top'}
              onChange={(tabLayout) => handleUpdate({ tabLayout })}
            />
          </div>

          {/* Toggles principais */}
          <div className="settings-flyout-group">
            <div className="settings-flyout-toggles">
              {/* Barra de favoritos */}
              <label className="settings-flyout-toggle-row">
                <div className="settings-flyout-toggle-icon">
                  <Bookmark size={15} strokeWidth={2.2} />
                </div>
                <div className="settings-flyout-toggle-info">
                  <span className="settings-flyout-toggle-label">Barra de favoritos</span>
                  <span className="settings-flyout-toggle-desc">Exibir abaixo da barra de busca</span>
                </div>
                <div className="settings-flyout-switch">
                  <input
                    type="checkbox"
                    checked={settings?.showBookmarksBar ?? false}
                    onChange={(e) => handleUpdate({ showBookmarksBar: e.target.checked })}
                  />
                  <span className="settings-flyout-slider" />
                </div>
              </label>

              {/* Economia de memória */}
              <label className="settings-flyout-toggle-row">
                <div className="settings-flyout-toggle-icon">
                  <Cpu size={15} strokeWidth={2.2} />
                </div>
                <div className="settings-flyout-toggle-info">
                  <span className="settings-flyout-toggle-label">Economia de memória</span>
                  <span className="settings-flyout-toggle-desc">Suspender abas inativas</span>
                </div>
                <div className="settings-flyout-switch">
                  <input
                    type="checkbox"
                    checked={settings?.memorySaverEnabled ?? false}
                    onChange={(e) => handleUpdate({ memorySaverEnabled: e.target.checked })}
                  />
                  <span className="settings-flyout-slider" />
                </div>
              </label>

              {/* Restaurar sessão */}
              <label className="settings-flyout-toggle-row">
                <div className="settings-flyout-toggle-icon">
                  <History size={15} strokeWidth={2.2} />
                </div>
                <div className="settings-flyout-toggle-info">
                  <span className="settings-flyout-toggle-label">Restaurar abas</span>
                  <span className="settings-flyout-toggle-desc">Continuar de onde parou ao abrir</span>
                </div>
                <div className="settings-flyout-switch">
                  <input
                    type="checkbox"
                    checked={settings?.restoreSession ?? false}
                    onChange={(e) => handleUpdate({ restoreSession: e.target.checked })}
                  />
                  <span className="settings-flyout-slider" />
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="settings-flyout-footer settings-flyout-footer--tiles">
          <button
            className="settings-flyout-tile"
            onClick={() => {
              setIsOpen(false)
              window.lumo.closeSettingsFlyout()
              window.lumo.openModStore()
            }}
          >
            <Store size={18} strokeWidth={2} />
            <span>Loja de mods</span>
          </button>
          <button className="settings-flyout-tile" onClick={handleOpenAdvanced}>
            <SlidersHorizontal size={18} strokeWidth={2} />
            <span>Todas as configurações</span>
          </button>
        </div>
      </div>
    </div>
  )
}
