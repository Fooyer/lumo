import type { ThemeSettings } from '@shared/ipc'
import { contrast } from './useTheme'

export type ThemeMode = 'dark' | 'light'

/** Backgrounds of the two ready-made modes; the accent colors are kept, deriveTheme adapts text and controls. */
export const MODE_BG: Record<ThemeMode, string> = { dark: '#14151d', light: '#f4f5f9' }

/** Whichever side the current background falls on, so a custom background still lights up the right button. */
export function themeMode(theme: ThemeSettings): ThemeMode {
  return contrast('#000000', theme.bg) > contrast('#ffffff', theme.bg) ? 'light' : 'dark'
}

export function withMode(theme: ThemeSettings, mode: ThemeMode): ThemeSettings {
  return { ...theme, bg: MODE_BG[mode] }
}
