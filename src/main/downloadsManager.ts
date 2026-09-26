import fs from 'fs'
import { extname, basename, join } from 'path'
import { randomUUID } from 'crypto'
import { app, BrowserWindow, dialog, session, shell, type DownloadItem as ElectronDownloadItem } from 'electron'
import type { DownloadItem } from '../shared/ipc'

const HISTORY_LIMIT = 200

/** <dir>/<name>, or "<name> (1).ext", "(2)"… when a file with that name is already there. */
function uniquePath(dir: string, filename: string): string {
  const safe = basename(filename) || 'download'
  const ext = extname(safe)
  const stem = safe.slice(0, safe.length - ext.length)
  let candidate = join(dir, safe)
  for (let n = 1; fs.existsSync(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

export class DownloadsManager {
  private items: DownloadItem[]
  private electronItems = new Map<string, ElectronDownloadItem>()
  private sources = new Map<string, Electron.WebContents>()
  private onUpdate: () => void = () => {}

  constructor(
    private filePath: string,
    ses: Electron.Session = session.defaultSession
  ) {
    this.items = this.load()
    this.attachSession(ses, false)
  }

  /** Tracks the downloads of a session; a private one's are kept out of the saved list. */
  attachSession(ses: Electron.Session, isPrivate: boolean): void {
    ses.on('will-download', (_event, item, webContents) => this.trackDownload(item, webContents, isPrivate))
  }

  /** Drops the private downloads from the list (the files themselves stay where the user saved them). */
  purgePrivate(): void {
    const before = this.items.length
    this.items = this.items.filter((d) => !d.incognito || d.state === 'progressing')
    if (this.items.length !== before) this.onUpdate()
  }

  /** True while a download started by this page is still in flight (closing the page would abort it). */
  isDownloadingFrom(webContents: Electron.WebContents): boolean {
    for (const source of this.sources.values()) if (source === webContents) return true
    return false
  }

  private load(): DownloadItem[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as DownloadItem[]
      return raw.map((d) => (d.state === 'progressing' ? { ...d, state: 'interrupted' } : d))
    } catch {
      return []
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.items.filter((d) => !d.incognito).slice(0, HISTORY_LIMIT), null, 2)
      )
    } catch {
      // disco indisponível: mantém apenas em memória nesta sessão
    }
  }

  setOnUpdate(cb: () => void): void {
    this.onUpdate = cb
  }

  private trackDownload(item: ElectronDownloadItem, webContents: Electron.WebContents, isPrivate: boolean): void {
    // Ask where to save ("Save as"). Electron's own dialog is left out on purpose: with page views it may
    // not find a parent window and the download then waits on a dialog nobody sees. Asking here, parented
    // to the window, is reliable. The Downloads folder is the suggested place.
    const parent = BrowserWindow.fromWebContents(webContents) ?? BrowserWindow.getAllWindows()[0]
    const suggested = uniquePath(app.getPath('downloads'), item.getFilename())
    const chosen = parent
      ? dialog.showSaveDialogSync(parent, { defaultPath: suggested })
      : dialog.showSaveDialogSync({ defaultPath: suggested })
    if (!chosen) {
      item.cancel()
      return
    }
    item.setSavePath(chosen)
    const id = randomUUID()
    const entry: DownloadItem = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: item.getSavePath(),
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startTime: Date.now(),
      ...(isPrivate ? { incognito: true } : {})
    }
    this.items.unshift(entry)
    this.items = this.items.slice(0, HISTORY_LIMIT)
    this.electronItems.set(id, item)
    this.sources.set(id, webContents)
    this.onUpdate()
    this.save()

    item.on('updated', (_e, state) => {
      entry.receivedBytes = item.getReceivedBytes()
      entry.totalBytes = item.getTotalBytes()
      entry.savePath = item.getSavePath()
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      this.onUpdate()
    })

    item.once('done', (_e, state) => {
      entry.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      entry.receivedBytes = item.getReceivedBytes()
      entry.savePath = item.getSavePath()
      this.electronItems.delete(id)
      this.sources.delete(id)
      this.onUpdate()
      this.save()
    })
  }

  list(): DownloadItem[] {
    return this.items
  }

  cancel(id: string): void {
    this.electronItems.get(id)?.cancel()
  }

  open(id: string): void {
    const entry = this.items.find((d) => d.id === id)
    if (entry?.savePath) shell.openPath(entry.savePath)
  }

  showInFolder(id: string): void {
    const entry = this.items.find((d) => d.id === id)
    if (entry?.savePath) shell.showItemInFolder(entry.savePath)
  }

  clearFinished(): void {
    this.items = this.items.filter((d) => d.state === 'progressing')
    this.onUpdate()
    this.save()
  }
}
