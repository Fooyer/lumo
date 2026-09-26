import fs from 'fs'
import type { Settings } from '../shared/ipc'

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
  mods: { theme: null, wallpaper: null, keyboard: null, tabs: null, music: null }
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
        ...raw,
        theme: { ...DEFAULTS.theme, ...(raw.theme ?? {}) },
        sounds: { ...DEFAULTS.sounds, ...(raw.sounds ?? {}) },
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
      mods: { ...this.data.mods, ...(partial.mods ?? {}) }
    }
    this.save()
    return this.data
  }
}
