import { useEffect, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Star } from 'lucide-react'
import type { TabSnapshot, AiStatusPayload } from '@shared/ipc'
import { useSuggestions } from '../lib/useSuggestions'

interface Props {
  activeTab: TabSnapshot | null
  onNavigate: (input: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  isBookmarked: boolean
  onToggleBookmark: () => void
  aiStatus: AiStatusPayload
  /** Dev/downloads/settings buttons shown at the end of the bar; omitted when they live elsewhere (sidebar layouts). */
  tools?: ReactNode
  /** Sits inside the top toolbar row, next to the window controls, instead of on its own row. */
  inline?: boolean
}

export default function AddressBar({
  activeTab,
  onNavigate,
  onBack,
  onForward,
  onReload,
  isBookmarked,
  onToggleBookmark,
  aiStatus,
  tools,
  inline = false
}: Props): JSX.Element {
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [spinning, setSpinning] = useState(false)
  // Suggestions are for what the user types, not for the current URL that fills the box on focus.
  const [dirty, setDirty] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // A click that gives the field focus selects its whole text (to type a new address from scratch); a
  // click into a field that already has focus places the caret as usual.
  const focusedByPointerRef = useRef(false)
  const go = (input: string): void => {
    onNavigate(input)
    setEditing(false)
    setDirty(false)
  }
  const suggestions = useSuggestions({
    value,
    setValue,
    inputRef,
    enabled: editing && dirty,
    anchorRef: formRef,
    owner: 'address-bar',
    onPick: go
  })

  useEffect(() => {
    if (!editing) setValue(activeTab?.url ?? '')
  }, [activeTab?.url, editing])

  const handleReload = (): void => {
    onReload()
    setSpinning(true)
    setTimeout(() => setSpinning(false), 500)
  }

  return (
    <div className={`address-bar ${inline ? 'address-bar--inline' : ''}`}>
      <button className="nav-btn nav-btn--back" onClick={onBack} disabled={!activeTab?.canGoBack} title="Voltar">
        <ArrowLeft size={16} strokeWidth={2.4} />
      </button>
      <button
        className="nav-btn nav-btn--forward"
        onClick={onForward}
        disabled={!activeTab?.canGoForward}
        title="Avançar"
      >
        <ArrowRight size={16} strokeWidth={2.4} />
      </button>
      <button
        className={`nav-btn nav-btn--reload ${
          activeTab?.loading ? 'nav-btn--spin-loading' : spinning ? 'nav-btn--spin-once' : ''
        }`}
        onClick={handleReload}
        title="Recarregar"
      >
        <RotateCw size={15} strokeWidth={2.4} />
      </button>

      <form
        ref={formRef}
        className="address-form"
        onSubmit={(e) => {
          e.preventDefault()
          const target = suggestions.selected?.url ?? value.trim()
          if (target) go(target)
        }}
      >
        <input
          ref={inputRef}
          className="address-input"
          value={value}
          placeholder="Digite uma URL, uma busca ou pergunte algo…"
          onMouseDown={(e) => {
            focusedByPointerRef.current = document.activeElement !== e.currentTarget
          }}
          // Releasing the button would otherwise collapse the selection into a caret.
          onMouseUp={(e) => {
            if (focusedByPointerRef.current) e.preventDefault()
            focusedByPointerRef.current = false
          }}
          onFocus={(e) => {
            setEditing(true)
            e.currentTarget.select()
          }}
          onBlur={() => {
            setEditing(false)
            setDirty(false)
          }}
          onChange={(e) => {
            suggestions.onChange(e)
            setEditing(true)
            setDirty(true)
          }}
          onKeyDown={suggestions.onKeyDown}
        />
        {aiStatus.busy && <span className="ai-pill">{aiStatus.message ?? 'Pensando…'}</span>}

        <button
          type="button"
          className={`star-btn ${isBookmarked ? 'star-btn--active' : ''}`}
          onClick={onToggleBookmark}
          disabled={!activeTab || activeTab.url.startsWith('lumo://')}
          title={isBookmarked ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          <Star size={15} strokeWidth={2.4} fill={isBookmarked ? 'currentColor' : 'none'} />
        </button>
      </form>

      {tools && <div className="address-bar__tools">{tools}</div>}
    </div>
  )
}
