import { app } from 'electron'
import type { Settings, MemorySnapshot } from '../shared/ipc'
import { TabManager } from './tabManager'

const POLL_MS = 5_000

export class MemoryManager {
  private timer: NodeJS.Timeout | null = null
  private onUpdate: (snapshot: MemorySnapshot) => void = () => {}

  constructor(
    private tabs: TabManager,
    private getSettings: () => Settings
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

    const readings = new Map<string, number>()
    const countedPids = new Set<number>()
    let totalKB = 0

    for (const tab of this.tabs.list()) {
      if (!tab.view) continue
      const pid = tab.view.webContents.getOSProcessId()
      const kb = byPid.get(pid)
      if (kb === undefined) continue
      readings.set(tab.id, kb / 1024)
      if (!countedPids.has(pid)) {
        countedPids.add(pid)
        totalKB += kb
      }
    }

    this.tabs.updateMemory(readings)

    if (settings.memorySaverEnabled) {
      const now = Date.now()
      const idleMs = settings.idleSuspendMinutes * 60_000
      for (const tab of this.tabs.idleCandidates()) {
        const memMB = readings.get(tab.id) ?? 0
        const isIdle = now - tab.lastActiveAt > idleMs
        const isHog = memMB > settings.tabMemoryBudgetMB
        if (isIdle || isHog) this.tabs.suspend(tab.id)
      }
    }

    this.onUpdate({
      totalMB: Math.round(totalKB / 1024),
      tabs: [...readings.entries()].map(([id, memoryMB]) => ({ id, memoryMB: Math.round(memoryMB) })),
      budgetMB: settings.tabMemoryBudgetMB,
      saverEnabled: settings.memorySaverEnabled
    })
  }
}
