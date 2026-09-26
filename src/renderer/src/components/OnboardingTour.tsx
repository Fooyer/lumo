import { useState } from 'react'
import { Bookmark, LayoutPanelLeft, Palette, PartyPopper, Store, Volume2 } from 'lucide-react'
import type { Settings } from '@shared/ipc'
import LayoutPicker from './LayoutPicker'
import ThemeModeToggle from './ThemeModeToggle'
import { PRESETS } from './AppearanceSection'

interface Props {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
}

const STEPS = ['Tema', 'Abas', 'Barras', 'Sons', 'Pronto'] as const

/** First-run tour: each step changes a real setting on the spot, so what's picked is what they'll get. */
export default function OnboardingTour({ settings, onChange }: Props): JSX.Element {
  const [step, setStep] = useState(0)
  const last = step === STEPS.length - 1
  const finish = (): void => onChange({ onboarded: true })
  const fromMod = settings.themeFromMod === true

  const colorField = (label: string, key: 'accent' | 'danger' | 'bg'): JSX.Element => (
    <label className="color-field">
      <span>{label}</span>
      <input
        type="color"
        disabled={fromMod}
        value={settings.theme[key]}
        onChange={(e) => onChange({ theme: { ...settings.theme, [key]: e.target.value } })}
      />
    </label>
  )

  const body = ((): JSX.Element => {
    switch (step) {
      case 0:
        return (
          <>
            <div className="tour__icon"><Palette size={22} strokeWidth={2.2} /></div>
            <h2>Bem-vindo ao Lumo</h2>
            <p>Vamos deixar o navegador com a sua cara. Comece escolhendo o tema.</p>
            <ThemeModeToggle theme={settings.theme} disabled={fromMod} onChange={(theme) => onChange({ theme })} />
            <div className="preset-row">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  className="preset-swatch"
                  title={p.name}
                  disabled={fromMod}
                  onClick={() => onChange({ theme: { ...settings.theme, accent: p.accent, danger: p.danger } })}
                >
                  <span style={{ background: p.accent }} />
                  <span style={{ background: p.danger }} />
                </button>
              ))}
            </div>
            <div className="color-field-row">
              {colorField('Destaque', 'accent')}
              {colorField('Secundária', 'danger')}
              {colorField('Fundo', 'bg')}
            </div>
          </>
        )
      case 1:
        return (
          <>
            <div className="tour__icon"><LayoutPanelLeft size={22} strokeWidth={2.2} /></div>
            <h2>Onde ficam as abas?</h2>
            <p>Em cima, nos lados ou embaixo. Dá para mudar quando quiser.</p>
            <LayoutPicker value={settings.tabLayout} onChange={(tabLayout) => onChange({ tabLayout })} />
          </>
        )
      case 2:
        return (
          <>
            <div className="tour__icon"><Bookmark size={22} strokeWidth={2.2} /></div>
            <h2>Barras</h2>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.showBookmarksBar}
                onChange={(e) => onChange({ showBookmarksBar: e.target.checked })}
              />
              Mostrar a barra de favoritos
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.autoHideAddressBar}
                onChange={(e) => onChange({ autoHideAddressBar: e.target.checked })}
              />
              Ocultar a barra de endereço automaticamente
            </label>
            <p className="settings-hint">Oculta, ela aparece quando você leva o mouse à borda da janela.</p>
          </>
        )
      case 3:
        return (
          <>
            <div className="tour__icon"><Volume2 size={22} strokeWidth={2.2} /></div>
            <h2>Sons e mods</h2>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.sounds.enabled}
                onChange={(e) => onChange({ sounds: { ...settings.sounds, enabled: e.target.checked } })}
              />
              Sons ao digitar e ao abrir/fechar abas
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.sounds.music}
                onChange={(e) => onChange({ sounds: { ...settings.sounds, music: e.target.checked } })}
              />
              Música de fundo (rádio lofi)
            </label>
            <p className="settings-hint">O Lumo também usa mods do Opera GX: cores, papel de parede e sons.</p>
            <button
              className="restart-btn restart-btn--ghost"
              onClick={() => {
                finish()
                window.lumo.openModStore()
              }}
            >
              <Store size={13} strokeWidth={2.4} /> Abrir a loja de mods
            </button>
          </>
        )
      default:
        return (
          <>
            <div className="tour__icon"><PartyPopper size={22} strokeWidth={2.2} /></div>
            <h2>Tudo pronto!</h2>
            <p>
              Ajustes rápidos ficam na engrenagem e os demais em "Todas as configurações". Para rever este tour, use
              "Refazer o tour" em Configurações → Geral.
            </p>
          </>
        )
    }
  })()

  return (
    <div className="alert-overlay">
      <div className="alert-modal tour" role="dialog" aria-modal="true" aria-label="Boas-vindas">
        <div className="tour__dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <i key={s} className={`tour__dot ${i === step ? 'tour__dot--active' : i < step ? 'tour__dot--done' : ''}`} />
          ))}
        </div>
        <div className="tour__body">{body}</div>
        <div className="tour__actions">
          {last ? (
            <span />
          ) : (
            <button className="alert-modal__secondary" onClick={finish}>
              Pular
            </button>
          )}
          <div className="tour__nav">
            {step > 0 && (
              <button className="alert-modal__secondary" onClick={() => setStep(step - 1)}>
                Voltar
              </button>
            )}
            <button className="alert-modal__ok" autoFocus onClick={last ? finish : () => setStep(step + 1)}>
              {last ? 'Começar' : 'Continuar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
