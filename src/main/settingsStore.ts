import fs from 'fs'
import type { Settings } from '../shared/ipc'
import { DEFAULT_ASSISTANT, RETIRED_GEMINI_MODELS } from '../shared/ai'

const DEFAULTS: Settings = {
  memorySaverEnabled: true,
  idleSuspendMinutes: 10,
  tabMemoryBudgetMB: 400,
  showBookmarksBar: true,
  theme: {
    accent: '#2e6bff',
    danger: '#ff4d6a',
    bg: '#14151d'
  },
  hardwareAccelerationEnabled: true,
  tabLayout: 'top',
  sidebarCollapsed: false,
  restoreSession: true,
  autoUpdate: true,
  autoHideAddressBar: false,
  onboarded: false,
  sounds: {
    enabled: false,
    volume: 60,
    keyboard: true,
    tabs: true,
    music: false,
    musicVolume: 40,
    duckMusic: true,
    musicSource: 'radio',
    radioUrl: 'https://stream.laut.fm/lofi',
    radioName: 'Lofi · laut.fm'
  },
  assistant: { ...DEFAULT_ASSISTANT },
  mods: { theme: null, wallpaper: null, keyboard: null, tabs: null, music: null }
}

function migrateAssistant(a: Settings['assistant']): Settings['assistant'] {
  if (a.provider === 'gemini' && RETIRED_GEMINI_MODELS.includes(a.model)) return { ...a, model: DEFAULT_ASSISTANT.model }
  return a
}

export class SettingsStore {
  private data: Settings

  constructor(private filePath: string) {
    this.data = this.load()
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      // Earlier versions had a single active mod (plus two on/off switches); it becomes a choice per part.
      const legacyId: string | null = raw.sounds?.modId ?? null
      const mods =
        raw.mods ??
        (legacyId
          ? {
              theme: raw.modTheme === false ? null : legacyId,
              wallpaper: raw.modWallpaper === false ? null : legacyId,
              keyboard: legacyId,
              tabs: legacyId,
              music: legacyId
            }
          : {})
      delete raw.modTheme
      delete raw.modWallpaper
      delete raw.sounds?.modId
      return {
        ...DEFAULTS,
        // A settings file from before the tour existed belongs to someone who already uses Lumo.
        onboarded: true,
        ...raw,
        theme: { ...DEFAULTS.theme, ...(raw.theme ?? {}) },
        sounds: { ...DEFAULTS.sounds, ...(raw.sounds ?? {}) },
        assistant: migrateAssistant({ ...DEFAULTS.assistant, ...(raw.assistant ?? {}) }),
        mods: { ...DEFAULTS.mods, ...mods }
      }
    } catch {
      return { ...DEFAULTS }
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
    } catch {
      // disco indisponível: mantém apenas em memória nesta sessão
    }
  }

  get(): Settings {
    return this.data
  }

  set(partial: Partial<Settings>): Settings {
    delete partial.themeFromMod
    this.data = {
      ...this.data,
      ...partial,
      theme: { ...this.data.theme, ...(partial.theme ?? {}) },
      sounds: { ...this.data.sounds, ...(partial.sounds ?? {}) },
      assistant: { ...this.data.assistant, ...(partial.assistant ?? {}) },
      mods: { ...this.data.mods, ...(partial.mods ?? {}) }
    }
    this.save()
    return this.data
  }
}
