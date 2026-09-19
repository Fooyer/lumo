import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC, type AnchorBounds } from '../shared/ipc'
import { positionFlyout } from './flyoutPosition'

const T0 = Date.now(); const L = (m) => console.log(`[FLY +${Date.now()-T0}ms] ${m}`)
const FLYOUT_WIDTH = 340
const FLYOUT_HEIGHT = 560

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

    for (const ev of ['show','hide','focus','blur','ready-to-show'] as const) this.win.on(ev as any, () => L('win '+ev+' isOpen='+this.isOpen))
    this.win.webContents.on('did-finish-load', () => L('did-finish-load'))
    this.win.on('blur', () => {
      this.close()
    })

    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  private initParentListeners(): void {
    this.parent.on('move', () => { L('PARENT move'); this.closeImmediate() })
    this.parent.on('resize', () => { L('PARENT resize'); this.closeImmediate() })
    this.parent.on('minimize', () => { L('PARENT minimize'); this.closeImmediate() })
    this.parent.on('close', () => this.destroy())
  }

  send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload)
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
    L("open() called")
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    if (!this.win || this.win.isDestroyed()) {
      this.createWindow()
    }
    if (!this.win) return

    const { x: popupX, y: popupY } = positionFlyout(this.parent, anchorBounds, {
      width: FLYOUT_WIDTH,
      height: FLYOUT_HEIGHT
    })

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
    L("close() called isOpen="+this.isOpen)
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
