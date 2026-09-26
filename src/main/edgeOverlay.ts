import { BrowserWindow, WebContentsView, type Rectangle } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC, type EdgeState } from '../shared/ipc'

const HIDE_ANIMATION_MS = 260

/**
 * The auto-hiding address bar: it slides in over the page from the top edge (under the tabs) or from the
 * bottom edge (above the tabs, in the bottom layout). It is a transparent WebContentsView
 * stacked above the page views, so showing it never resizes the page — the slide is a CSS transform
 * inside the view, on the compositor. The renderer is told to open/close (`ui:edge-state`) and plays
 * the animation; the view stays attached until the exit animation has finished.
 */
export class EdgeOverlay {
  readonly view: WebContentsView
  private open = false
  private attached = false
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private parent: BrowserWindow,
    hash: string,
    private computeBounds: () => Rectangle
  ) {
    this.view = new WebContentsView({
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
    })
    this.view.setBackgroundColor('#00000000')
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void this.view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
    } else {
      void this.view.webContents.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    parent.on('close', () => this.destroy())
  }

  get webContents(): Electron.WebContents {
    return this.view.webContents
  }

  get isOpen(): boolean {
    return this.open
  }

  get bounds(): Rectangle {
    return this.view.getBounds()
  }

  show(position: EdgeState['position']): void {
    if (this.view.webContents.isDestroyed()) return
    this.clearTimer()
    this.reposition()
    if (!this.attached) {
      this.parent.contentView.addChildView(this.view)
      this.attached = true
    }
    if (!this.open) {
      this.open = true
      this.view.webContents.send(IPC.edgeState, { open: true, position } satisfies EdgeState)
    }
  }

  hide(position: EdgeState['position']): void {
    if (!this.open) return
    this.open = false
    if (!this.view.webContents.isDestroyed()) this.view.webContents.send(IPC.edgeState, { open: false, position } satisfies EdgeState)
    this.clearTimer()
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      if (!this.open) this.detach()
    }, HIDE_ANIMATION_MS)
  }

  hideImmediate(position: EdgeState['position'] = 'top'): void {
    this.clearTimer()
    if (this.open && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send(IPC.edgeState, { open: false, position } satisfies EdgeState)
    }
    this.open = false
    this.detach()
  }

  /** Follows the window and the page area while attached. */
  reposition(): void {
    if (this.attached || !this.open) this.view.setBounds(this.computeBounds())
  }

  /** Re-adding moves the view back to the top of the stack (a page view attached later would cover it). */
  raise(): void {
    if (this.attached) this.parent.contentView.addChildView(this.view)
  }

  private detach(): void {
    if (this.attached && this.parent.contentView.children.includes(this.view)) {
      this.parent.contentView.removeChildView(this.view)
    }
    this.attached = false
  }

  private destroy(): void {
    this.clearTimer()
    this.detach()
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }

  private clearTimer(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = null
  }
}
