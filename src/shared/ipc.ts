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
  memoryGet: 'memory:get',
  aiStatus: 'ai:status',
  uiContentBounds: 'ui:content-bounds',
  tabsToggleDevtools: 'tabs:toggle-devtools',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowMaximizedChanged: 'window:maximized-changed',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
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
  historyList: 'history:list',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',
  historyChanged: 'history:changed',
  historySuggest: 'history:suggest',
  suggestionsFlyoutShow: 'suggestions:flyout-show',
  suggestionsFlyoutHide: 'suggestions:flyout-hide',
  suggestionsFlyoutState: 'suggestions:flyout-state',
  suggestionsFlyoutPick: 'suggestions:flyout-pick',
  suggestionsFlyoutHover: 'suggestions:flyout-hover',
  suggestionPicked: 'suggestions:picked',
  suggestionHovered: 'suggestions:hovered',
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateStatus: 'update:status',
  appRelaunch: 'app:relaunch',
  defaultBrowserGet: 'defaultbrowser:get',
  defaultBrowserSet: 'defaultbrowser:set',
  cacheGetSize: 'cache:get-size',
  cacheClear: 'cache:clear',
  alertDialogShow: 'dialog:alert-show',
  certWarningShow: 'dialog:cert-show',
  certWarningRespond: 'dialog:cert-respond',
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

export interface DefaultBrowserStatus {
  supported: boolean
  isDefault: boolean
}

export type TabLayout = 'top' | 'left' | 'right' | 'bottom'

export interface Settings {
  memorySaverEnabled: boolean
  idleSuspendMinutes: number
  tabMemoryBudgetMB: number
  showBookmarksBar: boolean
  theme: ThemeSettings
  hardwareAccelerationEnabled: boolean
  tabLayout: TabLayout
  sidebarCollapsed: boolean
  restoreSession: boolean
  /** Look for new versions on GitHub in the background (a manual check is always available). */
  autoUpdate: boolean
}

export interface AlertDialogPayload {
  id: string
  message: string
  domain: string
}

export interface CertWarningPayload {
  id: string
  url: string
  host: string
  error: string
}

export interface Bookmark {
  id: string
  title: string
  url: string
  favicon: string | null
  createdAt: number
}

/** A page the user has visited, aggregated across visits. */
export interface HistoryPage {
  url: string
  title: string
  favicon: string | null
  visitCount: number
  lastVisitAt: number
}

export interface HistoryVisit {
  id: string
  url: string
  visitedAt: number
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  favicon: string | null
  visitedAt: number
}

export interface HistoryListResult {
  items: HistoryEntry[]
  /** How many visits match, including those beyond the requested limit. */
  total: number
}

export interface Suggestion {
  url: string
  title: string
  favicon: string | null
  source: 'history' | 'bookmark'
  visitCount: number
}

/** What the suggestions flyout window draws. `owner` identifies the input that asked for it. */
export interface SuggestionsFlyoutState {
  owner: string
  items: Suggestion[]
  activeIndex: number
}

export interface SuggestionsFlyoutShow extends SuggestionsFlyoutState {
  /** The input the list drops down from, in the main window's client coordinates. */
  anchor: AnchorBounds
}

export interface SuggestionEvent {
  owner: string
}

export interface SuggestionPickedEvent extends SuggestionEvent {
  url: string
}

export interface SuggestionHoverEvent extends SuggestionEvent {
  index: number
}

/** The flyout window is sized from these, so the list's CSS rows must match them exactly. */
export const SUGGESTION_ROW_HEIGHT = 36
/** Vertical space around the rows: 6px padding + 1.5px border, top and bottom. */
export const SUGGESTIONS_FLYOUT_CHROME = 15

export type UpdateState = 'idle' | 'unsupported' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  /** The new version, once one was found. */
  version?: string
  /** Download progress, 0-100. */
  percent?: number
  error?: string
  checkedAt?: number
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
