import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC, type AnchorBounds } from '../shared/ipc'

const FLYOUT_WIDTH = 340
const FLYOUT_HEIGHT = 420

export class SettingsFlyout {
  private win: BrowserWindow | null = null
  private parent: BrowserWindow
  private isOpen = false
  private lastCloseTime = 0
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  constructor(parent: BrowserWindow) {
    this.parent = parent
    this.createWindow()
    this.initParentListeners()
  }

  private createWindow(): void {
    if (this.win && !this.win.isDestroyed()) return

    this.win = new BrowserWindow({
      parent: this.parent,
      width: FLYOUT_WIDTH,
      height: FLYOUT_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      resizable: false,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true
      }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#settings-flyout`)
    } else {
      this.win.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: 'settings-flyout'
      })
    }

    this.win.on('blur', () => {
      this.close()
    })

    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  private initParentListeners(): void {
    this.parent.on('move', () => this.closeImmediate())
    this.parent.on('resize', () => this.closeImmediate())
    this.parent.on('minimize', () => this.closeImmediate())
    this.parent.on('close', () => this.destroy())
  }

  toggle(anchorBounds?: AnchorBounds): void {
    if (this.isOpen) {
      this.close()
      return
    }
    if (Date.now() - this.lastCloseTime < 250) {
      return
    }
    this.open(anchorBounds)
  }

  open(anchorBounds?: AnchorBounds): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    if (!this.win || this.win.isDestroyed()) {
      this.createWindow()
    }
    if (!this.win) return

    const parentBounds = this.parent.getContentBounds()
    let popupX: number
    let popupY: number

    if (anchorBounds) {
      const anchorRight = parentBounds.x + anchorBounds.x + anchorBounds.width
      const anchorBottom = parentBounds.y + anchorBounds.y + anchorBounds.height
      popupX = Math.round(anchorRight - FLYOUT_WIDTH)
      popupY = Math.round(anchorBottom + 4)
    } else {
      popupX = Math.round(parentBounds.x + parentBounds.width - FLYOUT_WIDTH - 12)
      popupY = Math.round(parentBounds.y + 78)
    }

    const display = screen.getDisplayMatching(parentBounds)
    const workArea = display.workArea
    if (popupX + FLYOUT_WIDTH > workArea.x + workArea.width) {
      popupX = workArea.x + workArea.width - FLYOUT_WIDTH - 8
    }
    if (popupX < workArea.x) {
      popupX = workArea.x + 8
    }

    this.win.setBounds({
      x: popupX,
      y: popupY,
      width: FLYOUT_WIDTH,
      height: FLYOUT_HEIGHT
    })

    this.isOpen = true
    this.win.webContents.send(IPC.settingsFlyoutShow)
    this.win.show()
    this.win.focus()

    this.parent.webContents.send(IPC.settingsFlyoutChanged, true)
  }

  close(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (!this.isOpen) return
    this.isOpen = false
    this.lastCloseTime = Date.now()

    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(IPC.settingsFlyoutClose)
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null
        if (!this.isOpen && this.win && !this.win.isDestroyed()) {
          this.win.hide()
        }
      }, 160)
    }

    if (!this.parent.isDestroyed()) {
      this.parent.webContents.send(IPC.settingsFlyoutChanged, false)
    }
  }

  closeImmediate(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (!this.isOpen) return
    this.isOpen = false
    this.lastCloseTime = Date.now()

    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(IPC.settingsFlyoutClose)
      this.win.hide()
    }

    if (!this.parent.isDestroyed()) {
      this.parent.webContents.send(IPC.settingsFlyoutChanged, false)
    }
  }

  destroy(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    this.isOpen = false
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy()
      this.win = null
    }
  }
}
