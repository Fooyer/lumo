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
  autoHideAddressBar: false
}

export class SettingsStore {
  private data: Settings

  constructor(private filePath: string) {
    this.data = this.load()
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      return { ...DEFAULTS, ...raw, theme: { ...DEFAULTS.theme, ...(raw.theme ?? {}) } }
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
    this.data = {
      ...this.data,
      ...partial,
      theme: { ...this.data.theme, ...(partial.theme ?? {}) }
    }
    this.save()
    return this.data
  }
}
