import { useEffect } from 'react'
import type { ThemeSettings } from '@shared/ipc'
import { lighten } from './color'

export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--danger', theme.danger)
  root.style.setProperty('--bg', theme.bg)
  root.style.setProperty('--bg-elevated', lighten(theme.bg, 0.05))
  root.style.setProperty('--border', lighten(theme.bg, 0.14))
}

/** For the auxiliary web contents (bars, panels): follow the theme chosen in the settings. */
export function useTheme(): void {
  useEffect(() => {
    void window.lumo.getSettings().then((s) => applyTheme(s.theme))
    const off = window.lumo.onSettingsChanged((s) => applyTheme(s.theme))
    return () => {
      off()
    }
  }, [])
}
