import { app, BrowserWindow, ipcMain, session, shell, clipboard, Menu, screen, protocol, dialog, net } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  IPC,
  MOD_SCHEME,
  GX_STORE_URL,
  GX_STORE_MOD_PAGE,
  KEY_SOUND_EVENTS,
  type Settings,
  type AnchorBounds,
  type SuggestionsFlyoutShow,
  type SoundEvent,
  type ModInstallResult
} from '../shared/ipc'
import { TabManager, buildEditContextItems, searchUrl } from './tabManager'
import { MemoryManager } from './memoryManager'
import { SettingsStore } from './settingsStore'
import { SessionStore } from './sessionStore'
import { installWidevineFromBrowser, whenWidevineReady } from './widevine'
import { externalUrlsFromArgv, getDefaultBrowserStatus, makeDefaultBrowser } from './defaultBrowser'
import { BookmarksManager } from './bookmarksManager'
import { HistoryManager } from './historyManager'
import { DownloadsManager } from './downloadsManager'
import { OverlayPanel } from './overlayPanel'
import { EdgeOverlay } from './edgeOverlay'
import { SuggestionsFlyout } from './suggestionsFlyout'
import { Updater } from './updater'
import { getPrivateSession, wipePrivateSession } from './privateSession'
import { ModsManager } from './modsManager'

const settingsStore = new SettingsStore(join(app.getPath('userData'), 'lumo-settings.json'))
const bookmarksManager = new BookmarksManager(join(app.getPath('userData'), 'lumo-bookmarks.json'))
const historyManager = new HistoryManager(join(app.getPath('userData'), 'lumo-history.json'))
const modsManager = new ModsManager(join(app.getPath('userData'), 'mods'))
const updater = new Updater(() => settingsStore.get().autoUpdate)
const sessionStore = new SessionStore(join(app.getPath('userData'), 'lumo-session.json'))
const SESSION_SAVE_DEBOUNCE_MS = 800
// How the auto-hiding address bar is triggered: the cursor position is polled.
const ADDRESS_BAR_DEFAULT_PX = 56
// How far above the tab strip the cursor still counts as "at the bottom edge".
const BOTTOM_EDGE_SLOP_PX = 2
const EDGE_POLL_MS = 60
const EDGE_COLLAPSE_TICKS = 5
// Constructed once the app is ready (below) — it reads session.defaultSession, which isn't available before then.
let downloadsManager: DownloadsManager

/** What the renderers see: `theme` is the chosen mod's colors when the user picked a mod for the colors. */
function publicSettings(): Settings {
  const settings = settingsStore.get()
  const modTheme = settings.mods.theme ? modsManager.theme(settings.mods.theme) : null
  if (!modTheme) return { ...settings, themeFromMod: false }
  return { ...settings, theme: { ...settings.theme, ...modTheme }, themeFromMod: true }
}

// Mod audio is served from the mods folder through this scheme; `stream` lets the audio element seek.
protocol.registerSchemesAsPrivileged([
  { scheme: MOD_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

/** Which sound a key press makes; shortcuts (Ctrl/Alt/Cmd + key) and non-typing keys make none. */
function keySoundOf(input: Electron.Input): SoundEvent | null {
  if (input.type !== 'keyDown' || input.control || input.meta || input.alt) return null
  if (input.key === 'Backspace') return 'key-backspace'
  if (input.key === 'Enter') return 'key-enter'
  if (input.key === ' ') return 'key-space'
  return input.key.length === 1 ? 'key-letter' : null
}

// As the default browser, other programs launch Lumo with a URL: a second launch must hand that URL to
// the running window instead of opening another one.
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.exit(0)

let mainWindowRef: BrowserWindow | null = null
// Set once the first window has restored its tabs; URLs that arrive earlier are queued.
let openExternalUrl: ((url: string) => void) | null = null
const pendingExternalUrls: string[] = externalUrlsFromArgv(process.argv)

function handleExternalUrl(url: string): void {
  if (openExternalUrl) openExternalUrl(url)
  else pendingExternalUrls.push(url)
}

app.on('second-instance', (_event, argv) => {
  for (const url of externalUrlsFromArgv(argv)) handleExternalUrl(url)
  const win = mainWindowRef
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
})

// Electron's default user agent advertises "Electron/x" and the app name, which streaming sites and
// their CDNs (Crunchyroll's, for one) treat as a non-browser client and answer with 403. Present as
// the plain Chrome this build is based on instead.
const chromeMajor = process.versions.chrome.split('.')[0]
const uaPlatform =
  process.platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64'
app.userAgentFallback = `Mozilla/5.0 (${uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`

// On Linux, Google's sign-in answers "This browser or app may not be secure" to this Chromium build right
// after the e-mail step; Windows is accepted. Firefox sends no client hints and is let through, so on
// Linux — and only on accounts.google.com — Lumo presents itself as Firefox and drops the Sec-CH-UA* headers.
// It's decided at run time, so the same build behaves right on both systems.
const FIREFOX_LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'

/** The Linux-only sign-in tweak for one request: Firefox's user agent and no client hints. */
function googleSignInQuirk(url: string, headers: Record<string, string>): Record<string, string> {
  if (process.platform !== 'linux') return headers
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return headers
  }
  if (host !== 'accounts.google.com') return headers
  const out: Record<string, string> = { ...headers, 'User-Agent': FIREFOX_LINUX_UA }
  for (const name of Object.keys(out)) {
    if (name.toLowerCase().startsWith('sec-ch-ua')) delete out[name]
  }
  return out
}

function presentAsFirefoxToGoogleSignIn(): void {
  if (process.platform !== 'linux') return
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://accounts.google.com/*'] },
    (details, callback) => callback({ requestHeaders: googleSignInQuirk(details.url, { ...details.requestHeaders }) })
  )
}

// Chromium exposes FedCM (navigator.credentials.get({ identity })) but Electron has no dialog for it, so
// "Sign in with Google" buttons that try it fail outright. Turning it off makes them fall back to the pop-up flow.
app.commandLine.appendSwitch('disable-features', 'FedCm')

installWidevineFromBrowser()

// Must run before the app is ready / any window is created — can't be toggled at runtime afterwards.
if (!settingsStore.get().hardwareAccelerationEnabled) {
  app.disableHardwareAcceleration()
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    backgroundColor: publicSettings().theme.bg,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  const tabManager = new TabManager(mainWindow)
  tabManager.setHistory(historyManager)
  // Private tabs run in their own in-memory session; their downloads are tracked but never written to disk.
  downloadsManager.attachSession(getPrivateSession(googleSignInQuirk), true)
  tabManager.setOnPrivateClosed(() => {
    void wipePrivateSession()
    downloadsManager.purgePrivate()
  })
  const memoryManager = new MemoryManager(
    tabManager,
    () => settingsStore.get(),
    (wc) => downloadsManager.isDownloadingFrom(wc)
  )
  // Panels that open from toolbar buttons: views stacked above the page, not separate windows.
  const downloadsFlyout = new OverlayPanel(mainWindow, {
    hash: 'downloads-flyout',
    width: 380,
    height: 460,
    channels: { show: IPC.downloadsFlyoutShow, close: IPC.downloadsFlyoutClose, changed: IPC.downloadsFlyoutChanged }
  })
  const settingsFlyout = new OverlayPanel(mainWindow, {
    hash: 'settings-flyout',
    width: 340,
    height: 560,
    channels: { show: IPC.settingsFlyoutShow, close: IPC.settingsFlyoutClose, changed: IPC.settingsFlyoutChanged }
  })
  const suggestionsFlyout = new SuggestionsFlyout(mainWindow)

  // Sounds are played by the main window's renderer (the one page of the UI that always exists).
  const playSound = (event: SoundEvent): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.soundPlay, event)
  }
  tabManager.setOnSound(playSound)
  tabManager.setOnAudibleChange((audible) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.soundDuck, audible)
  })
  // Keys typed into a page are reported by that page's preload (only when a text field has focus).
  ipcMain.on(IPC.soundKey, (_e, event: SoundEvent) => {
    if (KEY_SOUND_EVENTS.includes(event)) playSound(event)
  })
  ipcMain.on(IPC.modsOpenStore, () => tabManager.create(GX_STORE_URL))
  ipcMain.handle(IPC.modsInstallStore, async (_e, tabId: unknown): Promise<ModInstallResult> => {
    const wc = typeof tabId === 'string' ? tabManager.list().find((t) => t.id === tabId)?.view?.webContents : undefined
    if (!wc || wc.isDestroyed() || !GX_STORE_MOD_PAGE.test(wc.getURL())) {
      return { ok: false, error: 'Abra a página de um mod da GX Store.' }
    }
    // The mod's files are addressed by three UUIDs that only its page shows. The page in the tab can't be read
    // for them: the store is a single-page app, so after browsing from one mod to another the document still
    // holds the data of the page that was loaded first. The server's own copy of this exact address is reliable.
    let html: string
    try {
      const res = await net.fetch(wc.getURL())
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      html = (await res.text()).replaceAll('\\/', '/')
    } catch {
      return { ok: false, error: 'Não consegui abrir a página do mod na loja. Verifique a conexão.' }
    }
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    const counts = new Map<string, number>()
    for (const m of html.matchAll(new RegExp(`mods\\.store\\.gx\\.me/mods/(${uuid})/(${uuid})/(${uuid})/`, 'g'))) {
      const key = `${m[1]}/${m[2]}/${m[3]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!best) return { ok: false, error: 'Não achei os arquivos deste mod na página. Espere ela carregar por completo.' }
    return modsManager.installFromStore(best.split('/') as [string, string, string])
  })
  ipcMain.handle(IPC.modsList, () => modsManager.list())
  ipcMain.handle(IPC.modsSounds, (_e, id: unknown) => (typeof id === 'string' ? modsManager.sounds(id) : null))
  ipcMain.handle(IPC.modsRemove, (_e, id: unknown) => {
    if (typeof id !== 'string') return
    modsManager.remove(id)
    // Whatever part was taken from the removed mod goes back to Lumo's own.
    const current = settingsStore.get().mods
    const cleared = Object.fromEntries(Object.entries(current).filter(([, v]) => v === id).map(([k]) => [k, null]))
    if (Object.keys(cleared).length) applySettings({ mods: cleared as Settings['mods'] })
  })
  ipcMain.handle(IPC.modsInstall, async (_e, kind: unknown): Promise<ModInstallResult> => {
    // Windows and Linux pickers can't choose a file or a folder in the same dialog.
    const folder = kind === 'folder'
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Instalar mod',
      properties: [folder ? 'openDirectory' : 'openFile'],
      filters: folder ? [] : [{ name: 'Mod (.zip, .crx)', extensions: ['zip', 'crx'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true }
    return modsManager.install(picked.filePaths[0])
  })

  // Auto-hide address bar: it slides in over the page from the top (under the tabs) or, in the bottom
  // layout, from the bottom (above the tabs) — a view above the page, so the page is never resized.
  let addressBarHeight = ADDRESS_BAR_DEFAULT_PX
  const addressBar = new EdgeOverlay(mainWindow, 'address-bar', () => {
    const [width, winH] = mainWindow.getContentSize()
    const height = Math.min(addressBarHeight, winH)
    const y =
      settingsStore.get().tabLayout === 'bottom'
        ? (tabManager.contentBottom() ?? winH) - height
        : (tabManager.contentTop() ?? 0)
    return { x: 0, y, width, height }
  })
  const bars = [addressBar]
  for (const bar of bars) {
    bar.webContents.on('before-input-event', (_e, input) => {
      const sound = keySoundOf(input)
      if (sound) playSound(sound)
    })
  }
  // Everything the bars render comes from the same broadcasts as the main window.
  const chromeSend = (channel: string, payload?: unknown): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
    for (const bar of bars) if (!bar.webContents.isDestroyed()) bar.webContents.send(channel, payload)
  }
  // A view attached after an overlay opened would cover it: put the bars, then the panels, back on top.
  tabManager.setOnViewsChanged(() => {
    for (const bar of bars) {
      bar.reposition()
      bar.raise()
    }
    downloadsFlyout.raise()
    settingsFlyout.raise()
  })
  // Overlay views report anchors in their own coordinates; the panels and the suggestions want the window's.
  const originOf = (sender: Electron.WebContents): { x: number; y: number } => {
    const bar = bars.find((b) => b.webContents === sender)
    return bar ? { x: bar.bounds.x, y: bar.bounds.y } : { x: 0, y: 0 }
  }
  const shiftAnchor = (sender: Electron.WebContents, a?: AnchorBounds): AnchorBounds | undefined => {
    if (!a) return a
    const o = originOf(sender)
    return { ...a, x: a.x + o.x, y: a.y + o.y }
  }
  // The suggestions reply goes to whichever UI asked for them (main window or the bottom bar).
  let suggestionsTarget: Electron.WebContents = mainWindow.webContents

  const sendTabs = (): void => {
    chromeSend(IPC.tabsUpdated, tabManager.snapshot())
  }

  // The open tabs are saved continuously (debounced), not only on exit, so a crash or a killed
  // process still leaves a recent session to restore.
  let sessionSaveTimer: NodeJS.Timeout | null = null
  let sessionClosed = false
  const saveSession = (): void => {
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer)
    sessionSaveTimer = null
    if (sessionClosed || !settingsStore.get().restoreSession) return
    const state = tabManager.getSessionState()
    if (state) sessionStore.save(state)
  }
  tabManager.setOnChange(() => {
    sendTabs()
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer)
    sessionSaveTimer = setTimeout(saveSession, SESSION_SAVE_DEBOUNCE_MS)
  })
  // Tear-down after this point closes the tabs one by one; that must not overwrite the saved session.
  mainWindow.on('close', () => {
    saveSession()
    sessionClosed = true
  })
  tabManager.setOnAiBusy((busy, message) => {
    chromeSend(IPC.aiStatus, { busy, message })
  })
  memoryManager.setOnUpdate((snapshot) => {
    mainWindow.webContents.send(IPC.memoryUpdated, snapshot)
  })
  tabManager.setOnCertWarning((payload) => {
    mainWindow.webContents.send(IPC.certWarningShow, payload)
  })
  ipcMain.on(IPC.certWarningRespond, (_e, id: string, proceed: boolean) =>
    tabManager.resolveCertWarning(id, proceed === true)
  )
  tabManager.setOnFullscreenChange((hidden) => {
    mainWindow.webContents.send(IPC.fullscreenChanged, hidden)
  })
  historyManager.setOnChange(() => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.historyChanged)
  })
  downloadsManager.setOnUpdate(() => {
    const list = downloadsManager.list()
    chromeSend(IPC.downloadsUpdated, list)
    // The panel is its own web contents, so it has to be told too (it's what shows live progress).
    downloadsFlyout.send(IPC.downloadsUpdated, list)
  })

  ipcMain.handle(IPC.tabsCreate, (_e, url?: string, activate = true) =>
    tabManager.create(url, { activate })
  )
  ipcMain.handle(IPC.tabsCreatePrivate, () => tabManager.create(undefined, { incognito: true }))
  ipcMain.handle(IPC.tabsClose, (_e, id: string) => tabManager.close(id))
  ipcMain.handle(IPC.tabsActivate, (_e, id: string) => tabManager.activate(id))
  ipcMain.handle(IPC.tabsGoBack, (_e, id: string) => tabManager.goBack(id))
  ipcMain.handle(IPC.tabsGoForward, (_e, id: string) => tabManager.goForward(id))
  ipcMain.handle(IPC.tabsReload, (_e, id: string) => tabManager.reload(id))
  ipcMain.handle(IPC.tabsSuspend, (_e, id: string) => tabManager.suspend(id))
  ipcMain.handle(IPC.tabsResume, (_e, id: string) => tabManager.resume(id))
  ipcMain.handle(IPC.tabsOrganize, () => tabManager.organizeWithAi())
  ipcMain.handle(IPC.tabsReopenClosed, () => tabManager.reopenLastClosed())
  ipcMain.on(IPC.tabsContextMenu, (_e, id: string) => tabManager.showTabContextMenu(id))
  ipcMain.on(IPC.tabsReorder, (_e, draggedId: string, beforeId: string | null) =>
    tabManager.reorder(draggedId, beforeId)
  )
  ipcMain.on(IPC.tabsCombineSplit, (_e, draggedId: string, targetId: string) =>
    tabManager.combineSplit(draggedId, targetId)
  )
  ipcMain.on(IPC.tabsRemoveFromSplit, (_e, id: string) => tabManager.removeFromSplit(id))
  ipcMain.handle(IPC.navigate, (_e, id: string, input: string) => tabManager.navigateSmart(id, input))
  ipcMain.handle(IPC.settingsGet, () => publicSettings())
  const applySettings = (partial: Partial<Settings>): Settings => {
    settingsStore.set(partial)
    const next = publicSettings()
    mainWindow.setBackgroundColor(next.theme.bg)
    // The main window, the panels and the suggestions list are separate renderers; keep them all in sync.
    chromeSend(IPC.settingsChanged, next)
    settingsFlyout.send(IPC.settingsChanged, next)
    downloadsFlyout.send(IPC.settingsChanged, next)
    suggestionsFlyout.send(IPC.settingsChanged, next)
    return next
  }
  ipcMain.handle(IPC.settingsSet, (_e, partial: Partial<Settings>) => applySettings(partial))
  ipcMain.handle(IPC.modsWallpaper, (_e, id: unknown) => (typeof id === 'string' ? modsManager.wallpaper(id) : null))
  ipcMain.on(IPC.uiContentBounds, (_e, r: AnchorBounds) => {
    if (![r?.x, r?.y, r?.width, r?.height].every((n) => Number.isFinite(n))) return
    tabManager.setContentBounds({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height)
    })
  })
  ipcMain.handle(IPC.tabsToggleDevtools, (_e, id: string) => tabManager.toggleDevTools(id))

  ipcMain.handle(IPC.bookmarksList, () => bookmarksManager.list())
  ipcMain.handle(IPC.bookmarksAdd, (_e, input: { title: string; url: string; favicon: string | null }) => {
    const bookmark = bookmarksManager.add(input)
    chromeSend(IPC.bookmarksUpdated, bookmarksManager.list())
    return bookmark
  })
  ipcMain.handle(IPC.bookmarksRemove, (_e, id: string) => {
    bookmarksManager.remove(id)
    chromeSend(IPC.bookmarksUpdated, bookmarksManager.list())
  })
  ipcMain.on(IPC.bookmarksReorder, (_e, draggedId: string, beforeId: string | null) => {
    bookmarksManager.reorder(draggedId, beforeId)
    chromeSend(IPC.bookmarksUpdated, bookmarksManager.list())
  })
  ipcMain.on(IPC.bookmarksContextMenu, (_e, id: string) => {
    const bookmark = bookmarksManager.list().find((b) => b.id === id)
    if (!bookmark) return
    const sendUpdated = (): void => chromeSend(IPC.bookmarksUpdated, bookmarksManager.list())
    Menu.buildFromTemplate([
      {
        label: 'Abrir',
        click: () => {
          const activeId = tabManager.getActiveId()
          if (activeId) void tabManager.navigateSmart(activeId, bookmark.url)
        }
      },
      { label: 'Abrir em nova aba', click: () => tabManager.create(bookmark.url, { activate: false }) },
      { label: 'Copiar link', click: () => clipboard.writeText(bookmark.url) },
      { type: 'separator' },
      {
        label: 'Mover para o início',
        click: () => {
          bookmarksManager.moveToStart(id)
          sendUpdated()
        }
      },
      {
        label: 'Mover para o final',
        click: () => {
          bookmarksManager.moveToEnd(id)
          sendUpdated()
        }
      },
      { type: 'separator' },
      {
        label: 'Remover dos favoritos',
        click: () => {
          bookmarksManager.remove(id)
          sendUpdated()
        }
      }
    ]).popup({ window: mainWindow })
  })

  ipcMain.handle(IPC.historyList, (_e, query: unknown, limit: unknown) =>
    historyManager.list(
      typeof query === 'string' ? query : '',
      Math.min(Math.max(Number(limit) || 200, 1), 2000)
    )
  )
  ipcMain.handle(IPC.historyRemove, (_e, id: string) => historyManager.removeVisit(id))
  ipcMain.handle(IPC.historyClear, () => historyManager.clear())
  ipcMain.handle(IPC.historySuggest, (_e, query: unknown) =>
    typeof query === 'string' ? historyManager.suggest(query, bookmarksManager.list(), 6) : []
  )
  ipcMain.on(IPC.suggestionsFlyoutShow, (e, payload: SuggestionsFlyoutShow) => {
    suggestionsTarget = e.sender
    suggestionsFlyout.show({ ...payload, anchor: shiftAnchor(e.sender, payload.anchor) ?? payload.anchor })
  })
  ipcMain.on(IPC.suggestionsFlyoutHide, () => suggestionsFlyout.hide())
  // The flyout is a separate window; its clicks and hovers are relayed back to the UI that owns the input.
  ipcMain.on(IPC.suggestionsFlyoutPick, (_e, owner: string, url: string, newTab: boolean) => {
    // Middle-click opens the page in the background and leaves the list up, so several can be opened in a row.
    if (newTab === true) {
      tabManager.create(url, { activate: false })
      return
    }
    suggestionsFlyout.hide()
    suggestionsTarget.send(IPC.suggestionPicked, { owner, url })
  })
  ipcMain.on(IPC.suggestionsFlyoutHover, (_e, owner: string, index: number) =>
    suggestionsTarget.send(IPC.suggestionHovered, { owner, index })
  )

  updater.setOnStatus((status) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.updateStatus, status)
  })
  ipcMain.handle(IPC.updateGet, () => updater.getStatus())
  ipcMain.handle(IPC.updateCheck, () => updater.check())
  ipcMain.on(IPC.updateInstall, () => updater.installNow())

  ipcMain.handle(IPC.downloadsList, () => downloadsManager.list())
  ipcMain.on(IPC.downloadsOpen, (_e, id: string) => downloadsManager.open(id))
  ipcMain.on(IPC.downloadsShowInFolder, (_e, id: string) => downloadsManager.showInFolder(id))
  ipcMain.on(IPC.downloadsCancel, (_e, id: string) => downloadsManager.cancel(id))
  ipcMain.on(IPC.downloadsClearFinished, () => downloadsManager.clearFinished())
  ipcMain.on(IPC.downloadsOpenPage, () => {
    downloadsFlyout.closeImmediate()
    tabManager.openInternal('lumo://downloads')
  })
  ipcMain.on(IPC.downloadsFlyoutToggle, (e, anchorBounds?: AnchorBounds) =>
    downloadsFlyout.toggle(shiftAnchor(e.sender, anchorBounds))
  )
  ipcMain.on(IPC.downloadsFlyoutClose, () => downloadsFlyout.close())
  ipcMain.on(IPC.settingsFlyoutToggle, (e, anchorBounds?: AnchorBounds) =>
    settingsFlyout.toggle(shiftAnchor(e.sender, anchorBounds))
  )
  ipcMain.on(IPC.settingsFlyoutClose, () => settingsFlyout.close())
  ipcMain.on(IPC.settingsOpenFull, () => {
    mainWindow.webContents.send(IPC.settingsOpenFull)
    settingsFlyout.closeImmediate()
  })

  ipcMain.handle(IPC.memoryGet, () => memoryManager.getSnapshot())
  ipcMain.handle(IPC.defaultBrowserGet, () => getDefaultBrowserStatus())
  ipcMain.handle(IPC.defaultBrowserSet, () => makeDefaultBrowser())
  ipcMain.handle(IPC.cacheGetSize, () => session.defaultSession.getCacheSize())
  ipcMain.handle(IPC.cacheClear, async () => {
    await session.defaultSession.clearCache()
    await session.defaultSession.clearCodeCaches({})
  })
  ipcMain.on(IPC.appRelaunch, () => {
    saveSession()
    app.relaunch()
    app.exit(0)
  })

  ipcMain.on(IPC.setModalActive, (_e, active: boolean) => tabManager.setModalActive(active))
  ipcMain.on('dialog:alert', (_e, payload: { message: string; domain: string }) => {
    mainWindow.webContents.send(IPC.alertDialogShow, {
      id: randomUUID(),
      message: payload.message,
      domain: payload.domain
    })
  })

  ipcMain.on(IPC.windowMinimize, () => mainWindow.minimize())
  ipcMain.on(IPC.windowToggleMaximize, () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on(IPC.windowClose, () => mainWindow.close())
  mainWindow.on('maximize', () => chromeSend(IPC.windowMaximizedChanged, true))
  mainWindow.on('unmaximize', () => chromeSend(IPC.windowMaximizedChanged, false))

  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && tabManager.handleShortcut(input)) {
      e.preventDefault()
      return
    }
    const sound = keySoundOf(input)
    if (sound) playSound(sound)
  })
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const items = buildEditContextItems(params, (query) => tabManager.create(searchUrl(query)))
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow })
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.once('did-finish-load', () => {
    const saved = settingsStore.get().restoreSession ? sessionStore.load() : null
    if (saved) tabManager.restoreSession(saved)
    else tabManager.create()
    memoryManager.start()
    updater.start()

    openExternalUrl = (url) => tabManager.create(url)
    for (const url of pendingExternalUrls.splice(0)) openExternalUrl(url)
  })

  mainWindowRef = mainWindow
  // The bar is shown by cursor position, not DOM hover (the toolbar is an app drag region, which swallows
  // mouse events). Top: it opens with the cursor over the toolbar (tabs/title) and stays while over the bar.
  // Bottom layout: it opens with the cursor on the tab strip and stays while over the bar. Either way it also
  // stays while its input has focus (the user is typing).
  let addressBarFocused = false
  let outsideTicks = 0
  let shownAt: 'top' | 'bottom' | null = null
  const edgeTimer = setInterval(() => {
    if (mainWindow.isDestroyed()) return
    const settings = settingsStore.get()
    const position = settings.tabLayout === 'bottom' ? 'bottom' : 'top'
    if (!settings.autoHideAddressBar || !mainWindow.isVisible() || mainWindow.isMinimized()) {
      addressBar.hideImmediate(position)
      return
    }
    // The layout changed while the bar was up: drop it instead of animating it across the window.
    if (shownAt && shownAt !== position) addressBar.hideImmediate(shownAt)
    shownAt = position

    const cursor = screen.getCursorScreenPoint()
    const content = mainWindow.getContentBounds()
    const cx = cursor.x - content.x
    const cy = cursor.y - content.y
    const insideX = cx >= 0 && cx < content.width

    let over: boolean
    if (position === 'bottom') {
      const edge = tabManager.contentBottom() ?? content.height
      const reach = addressBar.isOpen ? edge - addressBarHeight : edge - BOTTOM_EDGE_SLOP_PX
      over = insideX && cy >= reach && cy <= content.height
    } else {
      const edge = tabManager.contentTop() ?? 0
      const reach = addressBar.isOpen ? edge + addressBarHeight : edge
      over = insideX && cy >= 0 && cy < reach
    }
    if (over) {
      outsideTicks = 0
      addressBar.show(position)
    } else if (addressBar.isOpen && !addressBarFocused && ++outsideTicks >= EDGE_COLLAPSE_TICKS) {
      addressBar.hide(position)
    }
  }, EDGE_POLL_MS)
  ipcMain.on(IPC.addressBarFocus, (_e, focused: boolean) => {
    addressBarFocused = focused === true
  })
  ipcMain.on(IPC.addressBarHeight, (_e, height: number) => {
    if (!Number.isFinite(height) || height < 20 || height > 400) return
    addressBarHeight = Math.round(height)
    addressBar.reposition()
  })

  mainWindow.on('closed', () => {
    clearInterval(edgeTimer)
    memoryManager.stop()
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
      openExternalUrl = null
    }
  })
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  electronApp.setAppUserModelId('com.lumo.browser')

  downloadsManager = new DownloadsManager(join(app.getPath('userData'), 'lumo-downloads.json'))
  presentAsFirefoxToGoogleSignIn()
  protocol.handle(MOD_SCHEME, (request) => modsManager.handleRequest(request))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await whenWidevineReady()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Pending history writes are debounced; make sure the last visits reach the disk on the way out.
app.on('before-quit', () => historyManager.flush())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
