import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/ipc'

const FIRST_CHECK_DELAY_MS = 20 * 1000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/**
 * Keeps Lumo up to date from the GitHub releases of the repository configured in electron-builder.yml.
 * A found update is downloaded in the background and installed the next time the app quits (or right
 * away, when the user asks to restart).
 */
export class Updater {
  private status: UpdateStatus
  private timer: NodeJS.Timeout | null = null
  private listener: (status: UpdateStatus) => void = () => {}

  constructor(private isAutoCheckEnabled: () => boolean) {
    this.status = {
      state: app.isPackaged ? 'idle' : 'unsupported',
      currentVersion: app.getVersion()
    }
    if (app.isPackaged) this.wire()
  }

  setOnStatus(cb: (status: UpdateStatus) => void): void {
    this.listener = cb
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  private set(next: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...next }
    this.listener(this.status)
  }

  private wire(): void {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) =>
      this.set({ state: 'downloading', version: info.version, percent: 0 })
    )
    autoUpdater.on('update-not-available', () =>
      this.set({ state: 'up-to-date', version: undefined, percent: undefined, checkedAt: Date.now() })
    )
    autoUpdater.on('download-progress', (progress) => this.set({ percent: Math.round(progress.percent) }))
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ state: 'ready', version: info.version, percent: 100 })
    )
    autoUpdater.on('error', (err) =>
      this.set({ state: 'error', error: err?.message ?? String(err), checkedAt: Date.now() })
    )
  }

  /** Starts the automatic checks: shortly after launch, then every few hours. */
  start(): void {
    if (!app.isPackaged || this.timer) return
    const auto = (): void => {
      if (this.isAutoCheckEnabled()) void this.check()
    }
    setTimeout(auto, FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(auto, CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Looks for a new version now. Does nothing while a check or download is already running. */
  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.status
    if (this.status.state === 'checking' || this.status.state === 'downloading' || this.status.state === 'ready') {
      return this.status
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // the 'error' event already recorded the reason
    }
    return this.status
  }

  /** Quits, installs the downloaded update and reopens Lumo. */
  installNow(): void {
    if (this.status.state !== 'ready') return
    this.stop()
    autoUpdater.quitAndInstall(true, true)
  }
}
