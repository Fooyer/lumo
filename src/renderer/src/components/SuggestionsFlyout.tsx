import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import type { SuggestionsFlyoutState } from '@shared/ipc'
import { SUGGESTION_ROW_HEIGHT } from '@shared/ipc'
import FaviconImg from './FaviconImg'
import { lighten } from '../lib/color'

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
}

/** The content of the suggestions flyout window (see main/suggestionsFlyout.ts). */
export default function SuggestionsFlyout(): JSX.Element | null {
  const [state, setState] = useState<SuggestionsFlyoutState | null>(null)

  useEffect(() => {
    const applyTheme = (theme: { accent: string; danger: string; bg: string }): void => {
      const root = document.documentElement
      root.style.setProperty('--accent', theme.accent)
      root.style.setProperty('--danger', theme.danger)
      root.style.setProperty('--bg', theme.bg)
      root.style.setProperty('--bg-elevated', lighten(theme.bg, 0.05))
      root.style.setProperty('--border', lighten(theme.bg, 0.14))
    }
    void window.lumo.getSettings().then((s) => applyTheme(s.theme))
    const offSettings = window.lumo.onSettingsChanged((s) => applyTheme(s.theme))
    const offState = window.lumo.onSuggestionsFlyoutState(setState)
    return () => {
      offSettings()
      offState()
    }
  }, [])

  if (!state) return null

  return (
    <ul className="suggestions-flyout">
      {state.items.map((item, i) => (
        <li
          key={item.url}
          className={`suggestion ${i === state.activeIndex ? 'suggestion--active' : ''}`}
          style={{ height: SUGGESTION_ROW_HEIGHT }}
          onMouseMove={() => {
            if (i !== state.activeIndex) window.lumo.hoverSuggestion(state.owner, i)
          }}
          // On press rather than click: the choice lands even if the pointer drifts off the row while releasing.
          // preventDefault also stops the middle button from starting Windows' autoscroll.
          onMouseDown={(e) => {
            e.preventDefault()
            if (e.button === 0) window.lumo.pickSuggestion(state.owner, item.url, false)
            else if (e.button === 1) window.lumo.pickSuggestion(state.owner, item.url, true)
          }}
        >
          <FaviconImg src={item.favicon} className="suggestion__icon" fallbackClassName="suggestion__dot" />
          <span className="suggestion__title">{item.title || shortUrl(item.url)}</span>
          <span className="suggestion__url">{shortUrl(item.url)}</span>
          {item.source === 'bookmark' && <Star size={12} className="suggestion__star" fill="currentColor" />}
        </li>
      ))}
    </ul>
  )
}
