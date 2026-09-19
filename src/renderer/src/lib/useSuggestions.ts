import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject
} from 'react'
import type { Suggestion } from '@shared/ipc'
import { inlineCompletion } from './inlineCompletion'

interface Options {
  /** The input's current text, and how to change it (the hook fills in the completion through it). */
  value: string
  setValue: (value: string) => void
  inputRef: RefObject<HTMLInputElement>
  enabled: boolean
  /** The input's container; the list drops down from it. */
  anchorRef: RefObject<HTMLElement>
  /** Tells apart the inputs that share the one flyout window. */
  owner: string
  onPick: (url: string) => void
}

interface SuggestionBox {
  open: boolean
  /** Call from the input's onChange: it tracks what the user typed (as opposed to what was auto-filled). */
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  /** Call from the input's onKeyDown; handles the arrows and Escape while the list is open. */
  onKeyDown: (e: KeyboardEvent) => void
  /** The row highlighted with the arrow keys or the mouse, if any (Enter should open it instead of the typed text). */
  selected: Suggestion | null
}

/**
 * Pages to recommend for what the user types (from history + bookmarks), shown in the suggestions
 * flyout window — a separate window, so a live page underneath keeps running. Like other browsers,
 * it also fills the input with the top suggestion, leaving the added part selected so typing on or
 * pressing Backspace replaces it.
 */
export function useSuggestions({
  value,
  setValue,
  inputRef,
  enabled,
  anchorRef,
  owner,
  onPick
}: Options): SuggestionBox {
  // What the user typed. `value` may hold that plus an auto-filled tail, and completions are matched against this.
  const [query, setQuery] = useState(value)
  const [items, setItems] = useState<Suggestion[]>([])
  const [index, setIndex] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const [layoutTick, setLayoutTick] = useState(0)
  const requestRef = useRef(0)
  const shownRef = useRef(false)
  // Only text being added is completed; after a deletion the user is editing, not asking for help.
  const completeRef = useRef(false)
  const filledRef = useRef<string | null>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const setValueRef = useRef(setValue)
  setValueRef.current = setValue

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value
      const inputType = (e.nativeEvent as InputEvent).inputType ?? ''
      completeRef.current = !inputType.startsWith('delete')
      filledRef.current = null
      // Whatever row was highlighted belonged to the previous text.
      setIndex(-1)
      setQuery(next)
      setValueRef.current(next)
    },
    []
  )

  useEffect(() => {
    const trimmed = query.trim()
    // The counter drops answers to keystrokes that have since been superseded.
    const request = ++requestRef.current
    setDismissed(false)
    if (!enabled || !trimmed) {
      setItems([])
      setIndex(-1)
      return
    }
    void window.lumo.suggestPages(trimmed).then((result) => {
      if (request !== requestRef.current) return
      setItems(result)
      setIndex(fillInline(query, result) ? 0 : -1)
    })

    /** Fills the input with the top suggestion, selecting the part the user didn't type. */
    function fillInline(typed: string, suggestions: Suggestion[]): boolean {
      const input = inputRef.current
      if (!completeRef.current || !input || document.activeElement !== input) return false
      // Only when the caret is at the end of exactly what was typed; never over something edited since.
      if (input.value !== typed || input.selectionStart !== typed.length || input.selectionEnd !== typed.length) {
        return false
      }
      const completion = inlineCompletion(typed, suggestions)
      if (!completion) return false
      input.value = completion
      input.setSelectionRange(typed.length, completion.length)
      // The DOM already shows the completion; syncing state to the same text leaves the selection alone.
      setValueRef.current(completion)
      filledRef.current = completion
      return true
    }
  }, [query, enabled, inputRef])

  const open = enabled && !dismissed && items.length > 0

  // Clicks and hovers happen in the flyout window and come back through the main process.
  useEffect(() => {
    const offPicked = window.lumo.onSuggestionPicked((e) => {
      if (e.owner === owner) onPickRef.current(e.url)
    })
    const offHovered = window.lumo.onSuggestionHovered((e) => {
      if (e.owner === owner) setIndex(e.index)
    })
    // The flyout is positioned in screen coordinates and hides itself when the window moves or resizes.
    const onResize = (): void => setLayoutTick((t) => t + 1)
    window.addEventListener('resize', onResize)
    return () => {
      offPicked()
      offHovered()
      window.removeEventListener('resize', onResize)
      if (shownRef.current) {
        shownRef.current = false
        window.lumo.hideSuggestionsFlyout()
      }
    }
  }, [owner])

  useEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (open && rect) {
      shownRef.current = true
      window.lumo.showSuggestionsFlyout({
        owner,
        items,
        activeIndex: index,
        anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })
    } else if (shownRef.current) {
      shownRef.current = false
      window.lumo.hideSuggestionsFlyout()
    }
  }, [open, items, index, layoutTick, owner, anchorRef])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndex((i) => (i >= items.length - 1 ? -1 : i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex((i) => (i <= -1 ? items.length - 1 : i - 1))
      } else if (e.key === 'Escape') {
        // Escape first takes back the auto-filled tail, then closes the list.
        const input = inputRef.current
        if (input && filledRef.current !== null && input.value === filledRef.current) {
          input.value = query
          setValueRef.current(query)
        }
        filledRef.current = null
        setDismissed(true)
        setIndex(-1)
      }
    },
    [open, items.length, inputRef, query]
  )

  return { open, onChange, onKeyDown, selected: open && index >= 0 ? items[index] : null }
}
