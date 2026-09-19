import fs from 'fs'
import { randomUUID } from 'crypto'
import { session, shell, type DownloadItem as ElectronDownloadItem } from 'electron'
import type { DownloadItem } from '../shared/ipc'

const HISTORY_LIMIT = 200

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
    ses.on('will-download', (_event, item, webContents) => this.trackDownload(item, webContents))
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
      fs.writeFileSync(this.filePath, JSON.stringify(this.items.slice(0, HISTORY_LIMIT), null, 2))
    } catch {
      // disco indisponível: mantém apenas em memória nesta sessão
    }
  }

  setOnUpdate(cb: () => void): void {
    this.onUpdate = cb
  }

  private trackDownload(item: ElectronDownloadItem, webContents: Electron.WebContents): void {
    const id = randomUUID()
    const entry: DownloadItem = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: item.getSavePath(),
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startTime: Date.now()
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
