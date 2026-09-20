import { app, BrowserWindow, ipcMain, session, shell, clipboard, Menu } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC, type Settings, type AnchorBounds, type SuggestionsFlyoutShow } from '../shared/ipc'
import { TabManager, buildEditContextItems, searchUrl } from './tabManager'
import { MemoryManager } from './memoryManager'
import { SettingsStore } from './settingsStore'
import { SessionStore } from './sessionStore'
import { installWidevineFromBrowser, whenWidevineReady } from './widevine'
import { externalUrlsFromArgv, getDefaultBrowserStatus, makeDefaultBrowser } from './defaultBrowser'
import { BookmarksManager } from './bookmarksManager'
import { HistoryManager } from './historyManager'
import { DownloadsManager } from './downloadsManager'
import { DownloadsFlyout } from './downloadsFlyout'
import { SettingsFlyout } from './settingsFlyout'
import { SuggestionsFlyout } from './suggestionsFlyout'
import { Updater } from './updater'

const settingsStore = new SettingsStore(join(app.getPath('userData'), 'lumo-settings.json'))
const bookmarksManager = new BookmarksManager(join(app.getPath('userData'), 'lumo-bookmarks.json'))
const historyManager = new HistoryManager(join(app.getPath('userData'), 'lumo-history.json'))
const updater = new Updater(() => settingsStore.get().autoUpdate)
const sessionStore = new SessionStore(join(app.getPath('userData'), 'lumo-session.json'))
const SESSION_SAVE_DEBOUNCE_MS = 800
// Constructed once the app is ready (below) — it reads session.defaultSession, which isn't available before then.
let downloadsManager: DownloadsManager

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

function presentAsFirefoxToGoogleSignIn(): void {
  if (process.platform !== 'linux') return
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://accounts.google.com/*'] },
    (details, callback) => {
      const headers: Record<string, string> = { ...details.requestHeaders, 'User-Agent': FIREFOX_LINUX_UA }
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase().startsWith('sec-ch-ua')) delete headers[name]
      }
      callback({ requestHeaders: headers })
    }
  )
}

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
    backgroundColor: settingsStore.get().theme.bg,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  const tabManager = new TabManager(mainWindow)
  tabManager.setHistory(historyManager)
  const memoryManager = new MemoryManager(
    tabManager,
    () => settingsStore.get(),
    (wc) => downloadsManager.isDownloadingFrom(wc)
  )
  const downloadsFlyout = new DownloadsFlyout(mainWindow)
  const settingsFlyout = new SettingsFlyout(mainWindow)
  const suggestionsFlyout = new SuggestionsFlyout(mainWindow)

  const sendTabs = (): void => {
    mainWindow.webContents.send(IPC.tabsUpdated, tabManager.snapshot())
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
    mainWindow.webContents.send(IPC.aiStatus, { busy, message })
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
    mainWindow.webContents.send(IPC.downloadsUpdated, downloadsManager.list())
  })

  ipcMain.handle(IPC.tabsCreate, (_e, url?: string, activate = true) =>
    tabManager.create(url, { activate })
  )
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
  ipcMain.handle(IPC.settingsGet, () => settingsStore.get())
  ipcMain.handle(IPC.settingsSet, (_e, partial: Partial<Settings>) => {
    const next = settingsStore.set(partial)
    mainWindow.setBackgroundColor(next.theme.bg)
    // The main window and the quick-settings flyout are separate renderers; keep both in sync.
    mainWindow.webContents.send(IPC.settingsChanged, next)
    settingsFlyout.send(IPC.settingsChanged, next)
    return next
  })
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
    mainWindow.webContents.send(IPC.bookmarksUpdated, bookmarksManager.list())
    return bookmark
  })
  ipcMain.handle(IPC.bookmarksRemove, (_e, id: string) => {
    bookmarksManager.remove(id)
    mainWindow.webContents.send(IPC.bookmarksUpdated, bookmarksManager.list())
  })
  ipcMain.on(IPC.bookmarksReorder, (_e, draggedId: string, beforeId: string | null) => {
    bookmarksManager.reorder(draggedId, beforeId)
    mainWindow.webContents.send(IPC.bookmarksUpdated, bookmarksManager.list())
  })
  ipcMain.on(IPC.bookmarksContextMenu, (_e, id: string) => {
    const bookmark = bookmarksManager.list().find((b) => b.id === id)
    if (!bookmark) return
    const sendUpdated = (): void => mainWindow.webContents.send(IPC.bookmarksUpdated, bookmarksManager.list())
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
  ipcMain.on(IPC.suggestionsFlyoutShow, (_e, payload: SuggestionsFlyoutShow) =>
    suggestionsFlyout.show(payload)
  )
  ipcMain.on(IPC.suggestionsFlyoutHide, () => suggestionsFlyout.hide())
  // The flyout is a separate window; its clicks and hovers are relayed back to the UI that owns the input.
  ipcMain.on(IPC.suggestionsFlyoutPick, (_e, owner: string, url: string, newTab: boolean) => {
    // Middle-click opens the page in the background and leaves the list up, so several can be opened in a row.
    if (newTab === true) {
      tabManager.create(url, { activate: false })
      return
    }
    suggestionsFlyout.hide()
    mainWindow.webContents.send(IPC.suggestionPicked, { owner, url })
  })
  ipcMain.on(IPC.suggestionsFlyoutHover, (_e, owner: string, index: number) =>
    mainWindow.webContents.send(IPC.suggestionHovered, { owner, index })
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
  ipcMain.on(IPC.downloadsFlyoutToggle, (_e, anchorBounds?: AnchorBounds) =>
    downloadsFlyout.toggle(anchorBounds)
  )
  ipcMain.on(IPC.downloadsFlyoutClose, () => downloadsFlyout.close())
  ipcMain.on(IPC.settingsFlyoutToggle, (_e, anchorBounds?: AnchorBounds) =>
    settingsFlyout.toggle(anchorBounds)
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
  mainWindow.on('maximize', () => mainWindow.webContents.send(IPC.windowMaximizedChanged, true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send(IPC.windowMaximizedChanged, false))

  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && tabManager.handleShortcut(input)) e.preventDefault()
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
  mainWindow.on('closed', () => {
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
