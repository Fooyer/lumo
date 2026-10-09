import { BrowserWindow, WebContentsView, type Rectangle } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../shared/ipc'
import { CHAT_VIEW_HEIGHT, CHAT_VIEW_WIDTH, type MascotRect, type MascotStage } from '../shared/ai'
import { OVERLAY_SHADOW_PAD } from './overlayPanel'

const MARGIN = 8
const GAP = 6
const CHAT_CLOSE_MS = 170

/**
 * Lumi, the mascot. Two transparent views stacked above the page views (like the other overlays):
 * one holds the character — as small as she and her speech bubble, so every click elsewhere still reaches
 * the page — and the other the chat panel, which opens next to her and follows her. The character
 * renderer owns all the animation and tells us where her feet are (`mascot:rect`); we only move the view.
 */
export class MascotOverlay {
  readonly character: WebContentsView
  readonly chat: WebContentsView
  private rect: MascotRect | null = null
  private enabled = true
  private suppressed = new Set<string>()
  private charAttached = false
  private chatOpen = false
  private chatAttached = false
  private lastStage = ''
  private closeTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(
    private parent: BrowserWindow,
    private getStage: () => Rectangle
  ) {
    this.character = this.makeView('mascot')
    this.chat = this.makeView('mascot-chat')
    this.chat.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        e.preventDefault()
        this.closeChat()
      }
    })
    parent.on('close', () => this.destroy())
    parent.on('minimize', () => this.closeChat(true))
    // A view attached while the window is still hidden never becomes visible, so wait for the window.
    parent.on('show', () => this.sync())
    parent.on('restore', () => this.sync())
  }

  private makeView(hash: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
    })
    view.setBackgroundColor('#00000000')
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    return view
  }

  get isChatOpen(): boolean {
    return this.chatOpen
  }

  /** Sends to the character and the chat (whichever are alive). */
  broadcast(channel: string, payload?: unknown): void {
    for (const v of [this.character, this.chat]) if (!v.webContents.isDestroyed()) v.webContents.send(channel, payload)
  }

  send(channel: string, payload?: unknown): void {
    if (!this.character.webContents.isDestroyed()) this.character.webContents.send(channel, payload)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.closeChat(true)
    this.sync()
  }

  setSuppressed(reason: string, on: boolean): void {
    if (on) this.suppressed.add(reason)
    else this.suppressed.delete(reason)
    if (this.suppressed.size) this.closeChat(true)
    this.sync()
  }

  /** Attaches or detaches the character depending on whether she should be on screen now. */
  private sync(): void {
    if (this.destroyed) return
    const visible = this.enabled && this.suppressed.size === 0 && this.parent.isVisible()
    if (visible && !this.charAttached) {
      // A view with no size is "hidden" and its page never runs animation frames: give it a first size
      // (bottom-right of the page area) so it can start up and report where she really stands.
      const stage = this.getStage()
      this.character.setBounds({
        x: Math.max(0, stage.x + stage.width - 230),
        y: Math.max(0, stage.y + stage.height - 240),
        width: 200,
        height: 220
      })
      this.parent.contentView.addChildView(this.character)
      this.character.setVisible(true)
      this.charAttached = true
      this.reposition()
    } else if (!visible && this.charAttached) {
      this.parent.contentView.removeChildView(this.character)
      this.charAttached = false
    }
  }

  setRect(rect: MascotRect): void {
    this.rect = rect
    this.reposition()
  }

  /** The character renderer asks for the stage when it starts; it is resent when the page area changes. */
  sendStage(force = false): void {
    const s = this.getStage()
    const key = `${s.width}x${s.height}@${s.y}`
    if (!force && key === this.lastStage) return
    this.lastStage = key
    this.send(IPC.mascotStage, { width: s.width, height: s.height, top: s.y } satisfies MascotStage)
  }

  sendChatState(): void {
    this.broadcast(IPC.mascotChatState, this.chatOpen)
  }

  /** Follows the page area and the mascot; also keeps the stacking order (after page views were attached). */
  reposition(): void {
    if (this.destroyed) return
    this.sendStage()
    const stage = this.getStage()
    if (this.charAttached && this.rect) {
      const r = this.rect
      this.character.setBounds({
        x: Math.round(stage.x + r.fx - r.w / 2),
        y: Math.round(stage.y + r.fy - r.h),
        width: Math.round(r.w),
        height: Math.round(r.h)
      })
    }
    if (this.chatOpen) this.chat.setBounds(this.chatBounds(stage))
  }

  /** Where the chat card goes: beside her on the roomier side, or above her when the window is narrow. */
  private chatBounds(stage: Rectangle): Rectangle {
    const [winW, winH] = this.parent.getContentSize()
    const w = Math.min(CHAT_VIEW_WIDTH, winW - 2 * MARGIN)
    const h = Math.min(CHAT_VIEW_HEIGHT, winH - 2 * MARGIN)
    const r = this.rect ?? { fx: stage.width - 90, fy: stage.height - 8, w: 170, h: 220 }
    const feetX = stage.x + r.fx
    const feetY = stage.y + r.fy
    const left = feetX - r.w / 2
    const right = feetX + r.w / 2
    const top = feetY - r.h

    let x = feetX < winW / 2 ? right + GAP : left - GAP - w
    let y = feetY - h + 6
    if (x < MARGIN || x + w > winW - MARGIN) {
      x = feetX - w / 2
      y = top - h - GAP
    }
    x = Math.max(MARGIN, Math.min(x, winW - w - MARGIN))
    y = Math.max(MARGIN, Math.min(y, winH - h - MARGIN))
    return {
      x: Math.round(x) - OVERLAY_SHADOW_PAD,
      y: Math.round(y) - OVERLAY_SHADOW_PAD,
      width: w + 2 * OVERLAY_SHADOW_PAD,
      height: h + 2 * OVERLAY_SHADOW_PAD
    }
  }

  /** Re-adding a child view moves it to the top: called after page views were attached. */
  raise(): void {
    if (this.charAttached) this.parent.contentView.addChildView(this.character)
    if (this.chatAttached) this.parent.contentView.addChildView(this.chat)
  }

  openChat(): void {
    if (this.destroyed || this.chatOpen || !this.enabled || this.suppressed.size) return
    if (this.closeTimer) clearTimeout(this.closeTimer)
    this.closeTimer = null
    this.chatOpen = true
    this.chat.setBounds(this.chatBounds(this.getStage()))
    if (!this.chatAttached) {
      this.parent.contentView.addChildView(this.chat)
      this.chat.setVisible(true)
      this.chatAttached = true
    }
    this.sendChatState()
    this.chat.webContents.focus()
  }

  closeChat(immediate = false): void {
    if (!this.chatOpen) return
    this.chatOpen = false
    this.sendChatState()
    if (this.closeTimer) clearTimeout(this.closeTimer)
    const detach = (): void => {
      this.closeTimer = null
      if (this.chatOpen || !this.chatAttached) return
      if (this.parent.contentView.children.includes(this.chat)) this.parent.contentView.removeChildView(this.chat)
      this.chatAttached = false
    }
    if (immediate) detach()
    else this.closeTimer = setTimeout(detach, CHAT_CLOSE_MS)
    if (!this.parent.isDestroyed() && !this.parent.webContents.isDestroyed()) this.parent.webContents.focus()
  }

  toggleChat(): void {
    if (this.chatOpen) this.closeChat()
    else this.openChat()
  }

  private destroy(): void {
    this.destroyed = true
    if (this.closeTimer) clearTimeout(this.closeTimer)
    for (const v of [this.character, this.chat]) {
      if (this.parent.contentView.children.includes(v)) this.parent.contentView.removeChildView(v)
      if (!v.webContents.isDestroyed()) v.webContents.close()
    }
  }
}
