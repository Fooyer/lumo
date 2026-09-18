export const IPC = {
  tabsCreate: 'tabs:create',
  tabsClose: 'tabs:close',
  tabsActivate: 'tabs:activate',
  tabsGoBack: 'tabs:go-back',
  tabsGoForward: 'tabs:go-forward',
  tabsReload: 'tabs:reload',
  tabsSuspend: 'tabs:suspend',
  tabsResume: 'tabs:resume',
  tabsOrganize: 'tabs:organize',
  tabsReopenClosed: 'tabs:reopen-closed',
  tabsContextMenu: 'tabs:context-menu',
  tabsReorder: 'tabs:reorder',
  tabsCombineSplit: 'tabs:combine-split',
  tabsRemoveFromSplit: 'tabs:remove-from-split',
  fullscreenChanged: 'ui:fullscreen-changed',
  navigate: 'navigate:smart',
  tabsUpdated: 'tabs:updated',
  memoryUpdated: 'memory:updated',
  aiStatus: 'ai:status',
  uiToolbarHeight: 'ui:toolbar-height',
  uiPanelWidth: 'ui:panel-width',
  tabsToggleDevtools: 'tabs:toggle-devtools',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowMaximizedChanged: 'window:maximized-changed',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsFlyoutToggle: 'settings:flyout-toggle',
  settingsFlyoutClose: 'settings:flyout-close',
  settingsFlyoutChanged: 'settings:flyout-changed',
  settingsFlyoutShow: 'settings:flyout-show',
  settingsOpenFull: 'settings:open-full',
  bookmarksList: 'bookmarks:list',
  bookmarksAdd: 'bookmarks:add',
  bookmarksRemove: 'bookmarks:remove',
  bookmarksUpdated: 'bookmarks:updated',
  bookmarksContextMenu: 'bookmarks:context-menu',
  bookmarksReorder: 'bookmarks:reorder',
  downloadsList: 'downloads:list',
  downloadsUpdated: 'downloads:updated',
  downloadsOpen: 'downloads:open',
  downloadsShowInFolder: 'downloads:show-in-folder',
  downloadsCancel: 'downloads:cancel',
  downloadsClearFinished: 'downloads:clear-finished',
  downloadsFlyoutToggle: 'downloads:flyout-toggle',
  downloadsFlyoutClose: 'downloads:flyout-close',
  downloadsFlyoutChanged: 'downloads:flyout-changed',
  downloadsFlyoutShow: 'downloads:flyout-show',
  passwordsList: 'passwords:list',
  passwordsReveal: 'passwords:reveal',
  passwordsRemove: 'passwords:remove',
  passwordsUpdated: 'passwords:updated',
  appRelaunch: 'app:relaunch',
  alertDialogShow: 'dialog:alert-show',
  setModalActive: 'ui:set-modal-active'
} as const

export interface TabSnapshot {
  id: string
  url: string
  title: string
  favicon: string | null
  loading: boolean
  suspended: boolean
  isActive: boolean
  domain: string
  groupId: string
  groupLabel: string
  groupColor: string
  splitGroupId: string | null
  memoryMB: number | null
  lastActiveAt: number
  canGoBack: boolean
  canGoForward: boolean
}

export interface MemorySnapshot {
  totalMB: number
  tabs: { id: string; memoryMB: number }[]
  budgetMB: number
  saverEnabled: boolean
}

export interface NavigateResult {
  kind: 'navigate' | 'search' | 'answer' | 'error'
  detail: string
}

export interface AiStatusPayload {
  busy: boolean
  message: string | null
}

export interface ThemeSettings {
  accent: string
  danger: string
  bg: string
}

export interface Settings {
  memorySaverEnabled: boolean
  idleSuspendMinutes: number
  tabMemoryBudgetMB: number
  showBookmarksBar: boolean
  theme: ThemeSettings
  hardwareAccelerationEnabled: boolean
  autofillPasswordsEnabled: boolean
  autoSavePasswordsEnabled: boolean
}

export interface AlertDialogPayload {
  id: string
  message: string
  domain: string
}

export interface Bookmark {
  id: string
  title: string
  url: string
  favicon: string | null
  createdAt: number
}

export interface SavedPassword {
  id: string
  domain: string
  username: string
  updatedAt: number
}

export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadItem {
  id: string
  filename: string
  url: string
  savePath: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  startTime: number
}

export interface AnchorBounds {
  x: number
  y: number
  width: number
  height: number
}
