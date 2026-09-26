import { useState } from 'react'
import { FolderPlus, Pencil } from 'lucide-react'
import type { FolderPrompt } from '@shared/ipc'

interface Props {
  prompt: FolderPrompt
  onSubmit: (name: string) => void
  onCancel: () => void
}

/** Asks for the name of a new folder of bookmarks, or a new name for an existing one. */
export default function FolderNameModal({ prompt, onSubmit, onCancel }: Props): JSX.Element {
  const renaming = prompt.mode === 'rename'
  const [name, setName] = useState(renaming ? prompt.name ?? '' : '')
  const clean = name.trim()

  return (
    <div className="alert-overlay" onClick={onCancel}>
      <form
        className="alert-modal folder-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (clean) onSubmit(clean)
        }}
      >
        <div className="alert-modal__icon">
          {renaming ? <Pencil size={17} strokeWidth={2.2} /> : <FolderPlus size={18} strokeWidth={2.2} />}
        </div>
        <div className="alert-modal__domain">{renaming ? 'Renomear pasta' : 'Nova pasta de favoritos'}</div>
        <input
          className="folder-modal__input"
          autoFocus
          maxLength={60}
          value={name}
          placeholder="Nome da pasta"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="folder-modal__actions">
          <button type="button" className="alert-modal__secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="alert-modal__ok" disabled={!clean}>
            {renaming ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  )
}
