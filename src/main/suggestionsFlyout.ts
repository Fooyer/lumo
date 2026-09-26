import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import {
  IPC,
  SUGGESTION_ROW_HEIGHT,
  SUGGESTIONS_FLYOUT_CHROME,
  type SuggestionsFlyoutShow,
  type SuggestionsFlyoutState
} from '../shared/ipc'

const GAP_BELOW_INPUT = 6

/**
 * The dropdown under the address bar / home search. It's its own window because the page views are
 * native and always paint above our UI: a window is the only way to draw over a live page. It is
 * never focusable, so typing keeps going to the input in the main window while it's showing.
 */
export class SuggestionsFlyout {
  private win: BrowserWindow | null = null
  private ready = false
  private pending: SuggestionsFlyoutState | null = null
  private visible = false

  constructor(private parent: BrowserWindow) {
    this.createWindow()
    // The list is anchored in screen coordinates; the UI re-shows it once the window settles.
    parent.on('move', () => this.hide())
    parent.on('resize', () => this.hide())
    parent.on('minimize', () => this.hide())
    parent.on('close', () => this.destroy())
  }

  /** Sends something to the list's window (it is its own renderer, so it doesn't get the main window's broadcasts). */
  send(channel: string, payload: unknown): void {
    const wc = this.win?.webContents
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }

  private createWindow(): void {
    const win = new BrowserWindow({
      parent: this.parent,
      width: 300,
      height: SUGGESTION_ROW_HEIGHT + SUGGESTIONS_FLYOUT_CHROME,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      resizable: false,
      focusable: false,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true
      }
    })
    this.win = win

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#suggestions-flyout`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'suggestions-flyout' })
    }
    win.webContents.once('did-finish-load', () => {
      this.ready = true
      if (this.pending) win.webContents.send(IPC.suggestionsFlyoutState, this.pending)
      this.pending = null
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  show({ anchor, ...state }: SuggestionsFlyoutShow): void {
    const win = this.win
    if (!win || win.isDestroyed() || this.parent.isDestroyed()) return
    if (state.items.length === 0 || ![anchor?.x, anchor?.y, anchor?.width, anchor?.height].every(Number.isFinite)) {
      this.hide()
      return
    }

    const content = this.parent.getContentBounds()
    const height = state.items.length * SUGGESTION_ROW_HEIGHT + SUGGESTIONS_FLYOUT_CHROME
    // An input near the bottom edge (bottom tab layout) has no room below it: open the list upward instead.
    const below = anchor.y + anchor.height + GAP_BELOW_INPUT
    const y = below + height > content.height ? anchor.y - GAP_BELOW_INPUT - height : below
    win.setBounds({
      x: Math.round(content.x + anchor.x),
      y: Math.round(content.y + Math.max(0, y)),
      width: Math.round(anchor.width),
      height
    })

    if (this.ready) win.webContents.send(IPC.suggestionsFlyoutState, state)
    else this.pending = state

    if (!this.visible) {
      this.visible = true
      // Inactive on purpose: the main window keeps the keyboard focus.
      win.showInactive()
    }
  }

  hide(): void {
    this.pending = null
    if (!this.visible) return
    this.visible = false
    if (this.win && !this.win.isDestroyed()) this.win.hide()
  }

  private destroy(): void {
    this.visible = false
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
