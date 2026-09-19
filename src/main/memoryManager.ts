import { app } from 'electron'
import type { Settings, MemorySnapshot } from '../shared/ipc'
import { TabManager } from './tabManager'

const POLL_MS = 5_000

export class MemoryManager {
  private timer: NodeJS.Timeout | null = null
  private last: MemorySnapshot | null = null
  private onUpdate: (snapshot: MemorySnapshot) => void = () => {}

  constructor(
    private tabs: TabManager,
    private getSettings: () => Settings,
    private isDownloading: (wc: Electron.WebContents) => boolean = () => false
  ) {}

  setOnUpdate(cb: (snapshot: MemorySnapshot) => void): void {
    this.onUpdate = cb
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), POLL_MS)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private tick(): void {
    const settings = this.getSettings()
    const metrics = app.getAppMetrics()
    const byPid = new Map(metrics.map((m) => [m.pid, m.memory.workingSetSize]))
    const cpuByPid = new Map(metrics.map((m) => [m.pid, m.cpu.percentCPUUsage]))

    const readings = new Map<string, number>()
    // Whole-app total (browser, GPU and UI processes included), so it isn't 0 when only internal
    // pages such as the new-tab page are open.
    let totalKB = 0
    for (const kb of byPid.values()) totalKB += kb

    for (const tab of this.tabs.list()) {
      if (!tab.view) continue
      const kb = byPid.get(tab.view.webContents.getOSProcessId())
      if (kb !== undefined) readings.set(tab.id, kb / 1024)
    }

    this.tabs.updateMemory(readings)

    if (settings.memorySaverEnabled) {
      const now = Date.now()
      const idleMs = settings.idleSuspendMinutes * 60_000
      for (const tab of this.tabs.idleCandidates()) {
        const pid = tab.view?.webContents.getOSProcessId()
        const cpu = pid !== undefined ? (cpuByPid.get(pid) ?? 0) : 0
        if (this.tabs.isBusy(tab, cpu, this.isDownloading)) {
          tab.lastBusyAt = now
          continue
        }
        const memMB = readings.get(tab.id) ?? 0
        const isIdle = now - Math.max(tab.lastActiveAt, tab.lastBusyAt) > idleMs
        const isHog = memMB > settings.tabMemoryBudgetMB
        if (isIdle || isHog) this.tabs.suspend(tab.id)
      }
    }

    this.last = {
      totalMB: Math.round(totalKB / 1024),
      tabs: [...readings.entries()].map(([id, memoryMB]) => ({ id, memoryMB: Math.round(memoryMB) })),
      budgetMB: settings.tabMemoryBudgetMB,
      saverEnabled: settings.memorySaverEnabled
    }
    this.onUpdate(this.last)
  }

  getSnapshot(): MemorySnapshot | null {
    return this.last
  }
}
