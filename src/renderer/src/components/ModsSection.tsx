import { useState } from 'react'
import type { ModInfo, ModPart, Settings } from '@shared/ipc'
import { MOD_PARTS, adoptWholeMod } from '../lib/mods'
import { Item, Section } from './SettingsParts'

interface Props {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
  mods: ModInfo[]
  refreshMods: () => Promise<void>
}

const NONE = ''

export default function ModsSection({ settings, onChange, mods, refreshMods }: Props): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const install = async (kind: 'file' | 'folder'): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.lumo.installMod(kind)
      if (result.cancelled) return
      if (!result.ok || !result.mod) {
        setError(result.error ?? 'Não foi possível instalar o mod.')
        return
      }
      await refreshMods()
      // A mod just installed is one the user wants to try: use everything it has (the parts can be changed below).
      const mod = result.mod
      const usesSound = mod.hasKeyboard || mod.hasTabSounds
      onChange({
        ...adoptWholeMod(mod, settings.mods),
        ...(usesSound ? { sounds: { ...settings.sounds, enabled: true } } : {})
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    // Main resets whichever parts pointed at it, then broadcasts the settings.
    await window.lumo.removeMod(id)
    await refreshMods()
  }

  const setPart = (part: ModPart, id: string): void =>
    onChange({ mods: { ...settings.mods, [part]: id === NONE ? null : id } })

  const usesAny = Object.values(settings.mods).some(Boolean)

  return (
    <>
      <Section
        title="Mods"
        hint="Mods do Opera GX trazem sons, música, cores e papel de parede. O Lumo lê o mesmo formato."
      >
        <Item keywords="loja gx store baixar instalar mod arquivo pasta zip crx">
          <p className="settings-hint">
            Abra a loja de mods do GX, escolha um mod e clique em "Instalar no Lumo" na faixa que aparece no topo.
            Também dá para instalar de um arquivo ou de uma pasta.
          </p>
          <div className="settings-actions">
            <button className="restart-btn" onClick={() => window.lumo.openModStore()}>
              Abrir a loja de mods do GX
            </button>
            <button className="restart-btn restart-btn--ghost" disabled={busy} onClick={() => void install('file')}>
              Instalar de um arquivo (.zip / .crx)
            </button>
            <button className="restart-btn restart-btn--ghost" disabled={busy} onClick={() => void install('folder')}>
              Instalar de uma pasta
            </button>
          </div>
          {error && <p className="settings-hint settings-hint--error">{error}</p>}
        </Item>

        <Item keywords="mods instalados remover usar tudo">
          <h3 className="settings-subtitle">Instalados</h3>
          {mods.length === 0 ? (
            <p className="settings-hint">Nenhum mod instalado ainda.</p>
          ) : (
            <div className="mod-list">
              {mods.map((m) => {
                const inUse = Object.values(settings.mods).includes(m.id)
                return (
                  <div key={m.id} className={`mod-row ${inUse ? 'mod-row--active' : ''}`}>
                    {m.icon && <img className="mod-row__icon" src={m.icon} alt="" />}
                    <div className="mod-row__info">
                      <span className="mod-row__name">{m.name}</span>
                      <span className="mod-row__meta">
                        {[
                          m.author,
                          m.hasTheme && 'cores',
                          m.hasWallpaper && 'papel de parede',
                          m.hasKeyboard && 'teclado',
                          m.hasTabSounds && 'abas',
                          m.hasMusic && 'música'
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <button className="mod-row__btn" onClick={() => onChange(adoptWholeMod(m, settings.mods))}>
                      Usar tudo
                    </button>
                    <button className="mod-row__btn mod-row__btn--danger" onClick={() => void remove(m.id)}>
                      Remover
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Item>
      </Section>

      <Section
        title="Usar de cada mod"
        hint="Escolha, parte por parte, de onde vem cada coisa. Dá para misturar: as cores de um mod, o papel de parede de outro e os sons de um terceiro."
      >
        {MOD_PARTS.map(({ part, label, hint, has }) => (
          <Item key={part} keywords={`${label} ${hint} mesclar misturar combinar padrão`}>
            <label className="mod-part">
              <span className="mod-part__text">
                <b>{label}</b>
                <small>{hint}</small>
              </span>
              <select value={settings.mods[part] ?? NONE} onChange={(e) => setPart(part, e.target.value)}>
                <option value={NONE}>Padrão do Lumo</option>
                {mods.filter(has).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </Item>
        ))}
        <Item keywords="restaurar padrão resetar remover mod voltar">
          <button
            className="restart-btn restart-btn--ghost"
            disabled={!usesAny}
            onClick={() =>
              onChange({ mods: { theme: null, wallpaper: null, keyboard: null, tabs: null, music: null } })
            }
          >
            Voltar tudo ao padrão do Lumo
          </button>
        </Item>
      </Section>
    </>
  )
}
