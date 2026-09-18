import { useEffect, useState } from 'react'
import type { SavedPassword, Settings } from '@shared/ipc'

interface Props {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
}

export default function PasswordsSection({ settings, onChange }: Props): JSX.Element {
  const [passwords, setPasswords] = useState<SavedPassword[]>([])
  const [revealed, setRevealed] = useState<Record<string, string>>({})

  useEffect(() => {
    void window.lumo.listPasswords().then(setPasswords)
    const off = window.lumo.onPasswordsUpdated(setPasswords)
    return () => {
      off()
    }
  }, [])

  const toggleReveal = (id: string): void => {
    if (revealed[id] !== undefined) {
      setRevealed((r) => {
        const next = { ...r }
        delete next[id]
        return next
      })
      return
    }
    void window.lumo.revealPassword(id).then((pwd) => {
      if (pwd !== null) setRevealed((r) => ({ ...r, [id]: pwd }))
    })
  }

  return (
    <section className="settings-section">
      <h2>Senhas</h2>
      <p className="settings-hint">
        Salvas localmente e criptografadas com o cofre de segurança do sistema operacional.
      </p>

      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.autoSavePasswordsEnabled}
          onChange={(e) => onChange({ autoSavePasswordsEnabled: e.target.checked })}
        />
        Salvar senhas automaticamente ao fazer login
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.autofillPasswordsEnabled}
          onChange={(e) => onChange({ autofillPasswordsEnabled: e.target.checked })}
        />
        Preencher senhas salvas automaticamente
      </label>

      {passwords.length === 0 ? (
        <p className="settings-hint">Nenhuma senha salva ainda.</p>
      ) : (
        <div className="password-list">
          {passwords.map((p) => (
            <div key={p.id} className="password-row">
              <div className="password-row__info">
                <span className="password-row__domain">{p.domain}</span>
                <span className="password-row__user">{p.username || '(sem usuário)'}</span>
              </div>
              <span className="password-row__value">{revealed[p.id] ?? '••••••••'}</span>
              <button className="manager-row__btn" onClick={() => toggleReveal(p.id)}>
                {revealed[p.id] !== undefined ? 'Ocultar' : 'Mostrar'}
              </button>
              <button
                className="manager-row__btn manager-row__btn--danger"
                onClick={() => window.lumo.removePassword(p.id)}
              >
                Remover
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
