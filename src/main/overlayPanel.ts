import { BrowserWindow, WebContentsView } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { AnchorBounds } from '../shared/ipc'

/** Space around the card inside the view, so its CSS drop shadow has room to draw (keep in sync with App.css). */
export const OVERLAY_SHADOW_PAD = 12
const GAP = 4
const MARGIN = 8
const CLOSE_ANIMATION_MS = 160
// A click that closes the panel also lands on the button that opened it; without this it would reopen at once.
const REOPEN_GUARD_MS = 250
// Focus is still settling right after opening; a blur in that window isn't the user clicking away.
const BLUR_GRACE_MS = 150

export interface OverlayChannels {
  /** Sent to the panel just before it appears, so it can play its entrance animation. */
  show: string
  /** Sent to the panel when it starts closing, so it can play its exit animation. */
  close: string
  /** Sent to the main window with `true`/`false`, so the button that owns the panel can look pressed. */
  changed: string
}

interface Options {
  /** Which screen of the renderer bundle to load (`#downloads-flyout`, …). */
  hash: string
  /** Size of the card itself; the view is larger by the shadow padding. */
  width: number
  height: number
  channels: OverlayChannels
}

/**
 * A panel that opens from a toolbar button (downloads, quick settings). It is a transparent
 * WebContentsView stacked above the page views inside the main window — not a separate OS window —
 * so there is no native window shadow to get stuck on screen, no focus fight between windows, and the
 * page underneath is neither resized nor repainted. The view is only as big as the card, so every
 * click outside it still reaches the page. The card's shadow and animations are plain CSS.
 */
export class OverlayPanel {
  private view: WebContentsView | null = null
  private isOpen = false
  private lastCloseTime = 0
  private openedAt = 0
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private parent: BrowserWindow,
    private options: Options
  ) {
    this.createView()
    parent.on('resize', () => this.closeImmediate())
    parent.on('minimize', () => this.closeImmediate())
    parent.on('close', () => this.destroy())
  }

  private createView(): void {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true
      }
    })
    view.setBackgroundColor('#00000000')
    this.view = view

    const { hash } = this.options
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }

    view.webContents.on('blur', () => {
      if (Date.now() - this.openedAt > BLUR_GRACE_MS) this.close()
    })
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  send(channel: string, payload: unknown): void {
    const wc = this.view?.webContents
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }

  toggle(anchor?: AnchorBounds): void {
    if (this.isOpen) {
      this.close()
      return
    }
    if (Date.now() - this.lastCloseTime < REOPEN_GUARD_MS) return
    this.open(anchor)
  }

  /** Where the card goes, in the main window's client coordinates: under the button, or above it near the bottom edge. */
  private cardPosition(anchor: AnchorBounds | undefined): { x: number; y: number; width: number; height: number } {
    const [winW, winH] = this.parent.getContentSize()
    const width = Math.min(this.options.width, winW - 2 * MARGIN)
    const height = Math.min(this.options.height, winH - 2 * MARGIN)

    let x: number
    let y: number
    if (anchor) {
      const onLeftHalf = anchor.x + anchor.width / 2 < winW / 2
      x = onLeftHalf ? anchor.x : anchor.x + anchor.width - width
      y = anchor.y + anchor.height + GAP
      if (y + height > winH - MARGIN) y = anchor.y - height - GAP
    } else {
      x = winW - width - 12
      y = 78
    }
    x = Math.max(MARGIN, Math.min(x, winW - width - MARGIN))
    y = Math.max(MARGIN, Math.min(y, winH - height - MARGIN))
    return { x: Math.round(x), y: Math.round(y), width, height }
  }

  open(anchor?: AnchorBounds): void {
    this.clearHideTimer()
    if (!this.view || this.view.webContents.isDestroyed()) this.createView()
    const view = this.view
    if (!view) return

    const card = this.cardPosition(anchor)
    view.setBounds({
      x: card.x - OVERLAY_SHADOW_PAD,
      y: card.y - OVERLAY_SHADOW_PAD,
      width: card.width + 2 * OVERLAY_SHADOW_PAD,
      height: card.height + 2 * OVERLAY_SHADOW_PAD
    })

    this.isOpen = true
    this.openedAt = Date.now()
    this.raise()
    view.webContents.send(this.options.channels.show)
    view.webContents.focus()
    this.parent.webContents.send(this.options.channels.changed, true)
  }

  /** (Re)adding a child view moves it to the top, above any page view added since it opened. */
  raise(): void {
    if (this.isOpen && this.view) this.parent.contentView.addChildView(this.view)
  }

  /** Lets the exit animation play, then removes the view. */
  close(): void {
    this.clearHideTimer()
    if (!this.isOpen) return
    this.isOpen = false
    this.lastCloseTime = Date.now()
    this.send(this.options.channels.close, undefined)
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      if (!this.isOpen) this.detach()
    }, CLOSE_ANIMATION_MS)
    this.notifyParent(false)
  }

  closeImmediate(): void {
    this.clearHideTimer()
    if (!this.isOpen) return
    this.isOpen = false
    this.lastCloseTime = Date.now()
    this.send(this.options.channels.close, undefined)
    this.detach()
    this.notifyParent(false)
  }

  destroy(): void {
    this.clearHideTimer()
    this.isOpen = false
    const view = this.view
    this.view = null
    if (!view) return
    this.detach(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  private detach(view: WebContentsView | null = this.view): void {
    if (view && this.parent.contentView.children.includes(view)) this.parent.contentView.removeChildView(view)
  }

  private notifyParent(open: boolean): void {
    if (!this.parent.isDestroyed()) this.parent.webContents.send(this.options.channels.changed, open)
  }

  private clearHideTimer(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = null
  }
}
