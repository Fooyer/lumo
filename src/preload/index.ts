import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type TabSnapshot,
  type MemorySnapshot,
  type AiStatusPayload,
  type Settings,
  type Bookmark,
  type DownloadItem,
  type AlertDialogPayload,
  type CertWarningPayload,
  type DefaultBrowserStatus,
  type HistoryListResult,
  type Suggestion,
  type UpdateStatus,
  type SuggestionsFlyoutShow,
  type SuggestionsFlyoutState,
  type SuggestionPickedEvent,
  type SuggestionHoverEvent,
  type AnchorBounds
} from '../shared/ipc'

const api = {
  createTab: (url?: string, activate = true): Promise<string> =>
    ipcRenderer.invoke(IPC.tabsCreate, url, activate),
  closeTab: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsClose, id),
  activateTab: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsActivate, id),
  goBack: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsGoBack, id),
  goForward: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsGoForward, id),
  reload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsReload, id),
  suspendTab: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsSuspend, id),
  resumeTab: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsResume, id),
  organizeTabs: (): Promise<void> => ipcRenderer.invoke(IPC.tabsOrganize),
  reopenLastClosedTab: (): Promise<void> => ipcRenderer.invoke(IPC.tabsReopenClosed),
  showTabContextMenu: (id: string): void => ipcRenderer.send(IPC.tabsContextMenu, id),
  reorderTab: (draggedId: string, beforeId: string | null): void =>
    ipcRenderer.send(IPC.tabsReorder, draggedId, beforeId),
  combineSplit: (draggedId: string, targetId: string): void =>
    ipcRenderer.send(IPC.tabsCombineSplit, draggedId, targetId),
  removeFromSplit: (id: string): void => ipcRenderer.send(IPC.tabsRemoveFromSplit, id),
  navigate: (id: string, input: string): Promise<{ kind: string; detail: string }> =>
    ipcRenderer.invoke(IPC.navigate, id, input),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (partial: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.settingsSet, partial),
  onSettingsChanged: (cb: (settings: Settings) => void) => {
    const listener = (_e: unknown, settings: Settings): void => cb(settings)
    ipcRenderer.on(IPC.settingsChanged, listener)
    return () => ipcRenderer.removeListener(IPC.settingsChanged, listener)
  },
  toggleSettingsFlyout: (anchorBounds?: AnchorBounds): void =>
    ipcRenderer.send(IPC.settingsFlyoutToggle, anchorBounds),
  closeSettingsFlyout: (): void =>
    ipcRenderer.send(IPC.settingsFlyoutClose),
  onSettingsFlyoutChanged: (cb: (open: boolean) => void) => {
    const listener = (_e: unknown, open: boolean): void => cb(open)
    ipcRenderer.on(IPC.settingsFlyoutChanged, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.settingsFlyoutChanged, listener)
    }
  },
  onSettingsFlyoutShow: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.settingsFlyoutShow, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.settingsFlyoutShow, listener)
    }
  },
  onSettingsFlyoutClose: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.settingsFlyoutClose, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.settingsFlyoutClose, listener)
    }
  },
  openFullSettings: (): void =>
    ipcRenderer.send(IPC.settingsOpenFull),
  onOpenFullSettings: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.settingsOpenFull, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.settingsOpenFull, listener)
    }
  },
  setContentBounds: (rect: AnchorBounds): void => ipcRenderer.send(IPC.uiContentBounds, rect),
  toggleDevTools: (id: string): Promise<void> => ipcRenderer.invoke(IPC.tabsToggleDevtools, id),

  minimizeWindow: (): void => ipcRenderer.send(IPC.windowMinimize),
  toggleMaximizeWindow: (): void => ipcRenderer.send(IPC.windowToggleMaximize),
  closeWindow: (): void => ipcRenderer.send(IPC.windowClose),
  onWindowMaximizedChanged: (cb: (maximized: boolean) => void) => {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
    ipcRenderer.on(IPC.windowMaximizedChanged, listener)
    return () => ipcRenderer.removeListener(IPC.windowMaximizedChanged, listener)
  },

  listBookmarks: (): Promise<Bookmark[]> => ipcRenderer.invoke(IPC.bookmarksList),
  addBookmark: (input: { title: string; url: string; favicon: string | null }): Promise<Bookmark> =>
    ipcRenderer.invoke(IPC.bookmarksAdd, input),
  removeBookmark: (id: string): Promise<void> => ipcRenderer.invoke(IPC.bookmarksRemove, id),
  reorderBookmark: (draggedId: string, beforeId: string | null): void =>
    ipcRenderer.send(IPC.bookmarksReorder, draggedId, beforeId),
  showBookmarkContextMenu: (id: string): void => ipcRenderer.send(IPC.bookmarksContextMenu, id),
  onBookmarksUpdated: (cb: (bookmarks: Bookmark[]) => void) => {
    const listener = (_e: unknown, bookmarks: Bookmark[]): void => cb(bookmarks)
    ipcRenderer.on(IPC.bookmarksUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.bookmarksUpdated, listener)
  },

  listHistory: (query: string, limit: number): Promise<HistoryListResult> =>
    ipcRenderer.invoke(IPC.historyList, query, limit),
  removeHistoryVisit: (id: string): Promise<void> => ipcRenderer.invoke(IPC.historyRemove, id),
  clearHistory: (): Promise<void> => ipcRenderer.invoke(IPC.historyClear),
  suggestPages: (query: string): Promise<Suggestion[]> => ipcRenderer.invoke(IPC.historySuggest, query),
  onHistoryChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.historyChanged, listener)
    return () => ipcRenderer.removeListener(IPC.historyChanged, listener)
  },
  showSuggestionsFlyout: (payload: SuggestionsFlyoutShow): void =>
    ipcRenderer.send(IPC.suggestionsFlyoutShow, payload),
  hideSuggestionsFlyout: (): void => ipcRenderer.send(IPC.suggestionsFlyoutHide),
  onSuggestionPicked: (cb: (event: SuggestionPickedEvent) => void) => {
    const listener = (_e: unknown, event: SuggestionPickedEvent): void => cb(event)
    ipcRenderer.on(IPC.suggestionPicked, listener)
    return () => ipcRenderer.removeListener(IPC.suggestionPicked, listener)
  },
  onSuggestionHovered: (cb: (event: SuggestionHoverEvent) => void) => {
    const listener = (_e: unknown, event: SuggestionHoverEvent): void => cb(event)
    ipcRenderer.on(IPC.suggestionHovered, listener)
    return () => ipcRenderer.removeListener(IPC.suggestionHovered, listener)
  },
  // Used by the flyout window itself:
  onSuggestionsFlyoutState: (cb: (state: SuggestionsFlyoutState) => void) => {
    const listener = (_e: unknown, state: SuggestionsFlyoutState): void => cb(state)
    ipcRenderer.on(IPC.suggestionsFlyoutState, listener)
    return () => ipcRenderer.removeListener(IPC.suggestionsFlyoutState, listener)
  },
  pickSuggestion: (owner: string, url: string, newTab: boolean): void =>
    ipcRenderer.send(IPC.suggestionsFlyoutPick, owner, url, newTab),
  hoverSuggestion: (owner: string, index: number): void =>
    ipcRenderer.send(IPC.suggestionsFlyoutHover, owner, index),

  listDownloads: (): Promise<DownloadItem[]> => ipcRenderer.invoke(IPC.downloadsList),
  openDownload: (id: string): void => ipcRenderer.send(IPC.downloadsOpen, id),
  showDownloadInFolder: (id: string): void => ipcRenderer.send(IPC.downloadsShowInFolder, id),
  cancelDownload: (id: string): void => ipcRenderer.send(IPC.downloadsCancel, id),
  clearFinishedDownloads: (): void => ipcRenderer.send(IPC.downloadsClearFinished),
  toggleDownloadsFlyout: (anchorBounds?: AnchorBounds): void =>
    ipcRenderer.send(IPC.downloadsFlyoutToggle, anchorBounds),
  closeDownloadsFlyout: (): void =>
    ipcRenderer.send(IPC.downloadsFlyoutClose),
  onDownloadsFlyoutChanged: (cb: (open: boolean) => void) => {
    const listener = (_e: unknown, open: boolean): void => cb(open)
    ipcRenderer.on(IPC.downloadsFlyoutChanged, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.downloadsFlyoutChanged, listener)
    }
  },
  onDownloadsFlyoutShow: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.downloadsFlyoutShow, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.downloadsFlyoutShow, listener)
    }
  },
  onDownloadsFlyoutClose: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.downloadsFlyoutClose, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.downloadsFlyoutClose, listener)
    }
  },
  onDownloadsUpdated: (cb: (downloads: DownloadItem[]) => void) => {
    const listener = (_e: unknown, downloads: DownloadItem[]): void => cb(downloads)
    ipcRenderer.on(IPC.downloadsUpdated, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.downloadsUpdated, listener)
    }
  },

  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateGet),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: (): void => ipcRenderer.send(IPC.updateInstall),
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    const listener = (_e: unknown, status: UpdateStatus): void => cb(status)
    ipcRenderer.on(IPC.updateStatus, listener)
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener)
  },

  relaunchApp: (): void => ipcRenderer.send(IPC.appRelaunch),
  getDefaultBrowserStatus: (): Promise<DefaultBrowserStatus> => ipcRenderer.invoke(IPC.defaultBrowserGet),
  makeDefaultBrowser: (): Promise<void> => ipcRenderer.invoke(IPC.defaultBrowserSet),
  getCacheSize: (): Promise<number> => ipcRenderer.invoke(IPC.cacheGetSize),
  clearCache: (): Promise<void> => ipcRenderer.invoke(IPC.cacheClear),

  onTabsUpdated: (cb: (tabs: TabSnapshot[]) => void) => {
    const listener = (_e: unknown, tabs: TabSnapshot[]): void => cb(tabs)
    ipcRenderer.on(IPC.tabsUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.tabsUpdated, listener)
  },
  getMemory: (): Promise<MemorySnapshot | null> => ipcRenderer.invoke(IPC.memoryGet),
  onMemoryUpdated: (cb: (snapshot: MemorySnapshot) => void) => {
    const listener = (_e: unknown, snapshot: MemorySnapshot): void => cb(snapshot)
    ipcRenderer.on(IPC.memoryUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.memoryUpdated, listener)
  },
  onAiStatus: (cb: (status: AiStatusPayload) => void) => {
    const listener = (_e: unknown, status: AiStatusPayload): void => cb(status)
    ipcRenderer.on(IPC.aiStatus, listener)
    return () => ipcRenderer.removeListener(IPC.aiStatus, listener)
  },
  onFullscreenChanged: (cb: (hidden: boolean) => void) => {
    const listener = (_e: unknown, hidden: boolean): void => cb(hidden)
    ipcRenderer.on(IPC.fullscreenChanged, listener)
    return () => ipcRenderer.removeListener(IPC.fullscreenChanged, listener)
  },
  setModalActive: (active: boolean): void => ipcRenderer.send(IPC.setModalActive, active),
  onAlertDialog: (cb: (payload: AlertDialogPayload) => void) => {
    const listener = (_e: unknown, payload: AlertDialogPayload): void => cb(payload)
    ipcRenderer.on(IPC.alertDialogShow, listener)
    return () => ipcRenderer.removeListener(IPC.alertDialogShow, listener)
  },
  onCertWarning: (cb: (payload: CertWarningPayload) => void) => {
    const listener = (_e: unknown, payload: CertWarningPayload): void => cb(payload)
    ipcRenderer.on(IPC.certWarningShow, listener)
    return () => ipcRenderer.removeListener(IPC.certWarningShow, listener)
  },
  respondCertWarning: (id: string, proceed: boolean): void =>
    ipcRenderer.send(IPC.certWarningRespond, id, proceed)
}

contextBridge.exposeInMainWorld('lumo', api)

export type LumoApi = typeof api
