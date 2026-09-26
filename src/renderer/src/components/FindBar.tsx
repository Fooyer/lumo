import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { FindResult } from '@shared/ipc'

interface Props {
  /** The active tab; the search belongs to one page, so switching tabs closes the bar. */
  tabId: string | null
}

/** Find in page (Ctrl+F). The matching and highlighting are done by the page view in the main process. */
export default function FindBar({ tabId }: Props): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<FindResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef('')
  const openRef = useRef(false)
  textRef.current = text
  openRef.current = open

  const focusInput = (): void => {
    // The bar may just have been rendered: wait for the input to exist.
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  const step = (forward: boolean): void => {
    if (textRef.current) window.lumo.find(textRef.current, forward, true)
  }

  const close = (): void => {
    setOpen(false)
    setResult(null)
    window.lumo.stopFind()
  }

  useEffect(() => {
    const offAction = window.lumo.onShortcutAction((action) => {
      if (action === 'find') {
        setOpen(true)
        focusInput()
        // Reopening on a word that is still there highlights it again.
        if (textRef.current) window.lumo.find(textRef.current, true, false)
      } else if (action === 'find-next' || action === 'find-prev') {
        if (!openRef.current) {
          setOpen(true)
          focusInput()
        }
        step(action === 'find-next')
      }
    })
    const offResult = window.lumo.onFindResult(setResult)
    return () => {
      offAction()
      offResult()
    }
  }, [])

  useEffect(() => {
    if (!openRef.current) return
    setOpen(false)
    setResult(null)
  }, [tabId])

  if (!open) return null

  const noMatches = text !== '' && result !== null && result.matches === 0

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className={`find-bar__input ${noMatches ? 'find-bar__input--none' : ''}`}
        value={text}
        placeholder="Localizar na página"
        onChange={(e) => {
          setText(e.target.value)
          setResult(null)
          if (e.target.value) window.lumo.find(e.target.value, true, false)
          else window.lumo.stopFind()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(!e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      <span className="find-bar__count">
        {text === '' || result === null ? '' : result.matches === 0 ? 'Nenhum resultado' : `${result.active}/${result.matches}`}
      </span>
      <button className="find-bar__btn" title="Anterior (Shift+Enter)" onClick={() => step(false)}>
        <ChevronUp size={15} strokeWidth={2.4} />
      </button>
      <button className="find-bar__btn" title="Próxima (Enter)" onClick={() => step(true)}>
        <ChevronDown size={15} strokeWidth={2.4} />
      </button>
      <button className="find-bar__btn" title="Fechar (Esc)" onClick={close}>
        <X size={15} strokeWidth={2.4} />
      </button>
    </div>
  )
}
