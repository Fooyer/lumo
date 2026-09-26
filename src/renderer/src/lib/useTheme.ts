import { useEffect } from 'react'
import type { ThemeSettings } from '@shared/ipc'
import { hexToRgb, mix, rgba } from './color'

function channelLuminance(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/** WCAG contrast ratio between two colors, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Pushes `color` toward black or white, whichever the background is far from, until it stands out enough. */
function ensureContrast(color: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color
  const target = contrast('#000000', bg) > contrast('#ffffff', bg) ? '#000000' : '#ffffff'
  for (let step = 0.1; step <= 1; step += 0.1) {
    const candidate = mix(color, target, step)
    if (contrast(candidate, bg) >= min) return candidate
  }
  return target
}

/**
 * White text where it's legible (the buttons are bold, so 3:1 is enough), otherwise whichever of white or dark
 * reads better. Keeps the usual look for the default colors and only flips for light ones.
 */
function readableOn(...backgrounds: string[]): string {
  const worst = (fg: string): number => Math.min(...backgrounds.map((bg) => contrast(fg, bg)))
  const white = worst('#ffffff')
  if (white >= 3) return '#ffffff'
  return worst('#12141c') > white ? '#12141c' : '#ffffff'
}

/**
 * Every color the UI draws is derived from the three the user (or a mod) picks, so text and controls stay
 * readable whatever they are: a light theme flips the text dark, the accent is pushed away from the background
 * until it stands out, and what sits on top of the accent or danger color is white or black as needed.
 */
export function deriveTheme(theme: ThemeSettings): Record<string, string> {
  const bg = theme.bg
  const light = contrast('#000000', bg) > contrast('#ffffff', bg)

  let text = light ? '#14151d' : '#eef0f6'
  if (contrast(text, bg) < 7) text = light ? '#000000' : '#ffffff'
  let dimAmount = 0.4
  let dim = mix(text, bg, dimAmount)
  while (contrast(dim, bg) < 4.5 && dimAmount > 0) {
    dimAmount = Math.max(0, dimAmount - 0.05)
    dim = mix(text, bg, dimAmount)
  }

  const accent = ensureContrast(theme.accent, bg, 3)
  const danger = ensureContrast(theme.danger, bg, 3)
  const towardText = light ? '#000000' : '#ffffff'

  return {
    '--bg': bg,
    '--bg-elevated': mix(bg, towardText, 0.05),
    '--border': mix(bg, towardText, light ? 0.16 : 0.14),
    '--text': text,
    '--text-dim': dim,
    '--accent': accent,
    '--accent-strong': mix(accent, '#000000', 0.2),
    '--accent-soft': rgba(accent, 0.16),
    '--danger': danger,
    '--danger-strong': mix(danger, '#000000', 0.2),
    '--danger-soft': rgba(danger, 0.16),
    '--success': ensureContrast('#22c55e', bg, 3),
    '--on-accent': readableOn(accent),
    '--on-danger': readableOn(danger),
    '--on-gradient': readableOn(accent, danger),
    'color-scheme': light ? 'light' : 'dark'
  }
}

export function applyTheme(theme: ThemeSettings): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(deriveTheme(theme))) root.style.setProperty(name, value)
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
