import { app, BrowserWindow, ipcMain, shell, clipboard, Menu } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC, type Settings, type AnchorBounds } from '../shared/ipc'
import { TabManager, buildEditContextItems, searchUrl } from './tabManager'
import { MemoryManager } from './memoryManager'
import { SettingsStore } from './settingsStore'
import { BookmarksManager } from './bookmarksManager'
import { DownloadsManager } from './downloadsManager'
import { PasswordsManager } from './passwordsManager'
import { DownloadsFlyout } from './downloadsFlyout'
import { SettingsFlyout } from './settingsFlyout'

const settingsStore = new SettingsStore(join(app.getPath('userData'), 'lumo-settings.json'))
const bookmarksManager = new BookmarksManager(join(app.getPath('userData'), 'lumo-bookmarks.json'))
const passwordsManager = new PasswordsManager(join(app.getPath('userData'), 'lumo-passwords.json'))
// Constructed once the app is ready (below) — it reads session.defaultSession, which isn't available before then.
let downloadsManager: DownloadsManager

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
  const memoryManager = new MemoryManager(tabManager, () => settingsStore.get())
  const downloadsFlyout = new DownloadsFlyout(mainWindow)
  const settingsFlyout = new SettingsFlyout(mainWindow)

  const sendTabs = (): void => {
    mainWindow.webContents.send(IPC.tabsUpdated, tabManager.snapshot())
  }
  tabManager.setOnChange(sendTabs)
  tabManager.setOnAiBusy((busy, message) => {
    mainWindow.webContents.send(IPC.aiStatus, { busy, message })
  })
  memoryManager.setOnUpdate((snapshot) => {
    mainWindow.webContents.send(IPC.memoryUpdated, snapshot)
  })
  tabManager.setOnFullscreenChange((hidden) => {
    mainWindow.webContents.send(IPC.fullscreenChanged, hidden)
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
    return next
  })
  ipcMain.on(IPC.uiToolbarHeight, (_e, px: number) => tabManager.setToolbarHeight(px))
  ipcMain.on(IPC.uiPanelWidth, (_e, px: number) => tabManager.setPanelWidth(px))
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

  ipcMain.handle(IPC.passwordsList, () => passwordsManager.list())
  ipcMain.handle(IPC.passwordsReveal, (_e, id: string) => passwordsManager.reveal(id))
  ipcMain.handle(IPC.passwordsRemove, (_e, id: string) => {
    passwordsManager.remove(id)
    mainWindow.webContents.send(IPC.passwordsUpdated, passwordsManager.list())
  })
  ipcMain.on(IPC.appRelaunch, () => {
    app.relaunch()
    app.exit(0)
  })

  // Usadas apenas pelo preload injetado em cada aba (src/preload/tab.ts), não pela UI do app.
  ipcMain.handle('passwords:get-for-domain', (_e, domain: string) => {
    if (!settingsStore.get().autofillPasswordsEnabled) return null
    return passwordsManager.findForDomain(domain)
  })
  ipcMain.on('passwords:capture', (_e, payload: { domain: string; username: string; password: string }) => {
    if (!settingsStore.get().autoSavePasswordsEnabled || !payload.password) return
    passwordsManager.upsert(payload.domain, payload.username, payload.password)
    mainWindow.webContents.send(IPC.passwordsUpdated, passwordsManager.list())
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

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown') tabManager.handleShortcut(input)
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
    tabManager.create()
    memoryManager.start()
  })

  mainWindow.on('closed', () => memoryManager.stop())
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.lumo.browser')

  downloadsManager = new DownloadsManager(join(app.getPath('userData'), 'lumo-downloads.json'))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
