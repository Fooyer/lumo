export const IPC = {
  tabsCreate: 'tabs:create',
  tabsCreatePrivate: 'tabs:create-private',
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
  edgeState: 'ui:edge-state',
  addressBarFocus: 'ui:address-bar-focus',
  addressBarHeight: 'ui:address-bar-height',
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
  downloadsOpenPage: 'downloads:open-page',
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
  setModalActive: 'ui:set-modal-active',
  soundKey: 'sound:key',
  soundPlay: 'sound:play',
  soundDuck: 'sound:duck',
  modsList: 'mods:list',
  modsInstall: 'mods:install',
  modsRemove: 'mods:remove',
  modsSounds: 'mods:sounds',
  modsWallpaper: 'mods:wallpaper',
  modsOpenStore: 'mods:open-store',
  modsInstallStore: 'mods:install-store',
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
  /** A private tab: nothing about it is kept (see main/privateSession.ts). */
  incognito: boolean
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

/** The parts of a mod that can be used on their own. */
export type ModPart = 'theme' | 'wallpaper' | 'keyboard' | 'tabs' | 'music'
export type ModSelection = Record<ModPart, string | null>

export interface SoundSettings {
  /** Master switch for the effect sounds (typing, tabs). Everything is off until the user opts in. */
  enabled: boolean
  /** Effects volume, 0-100. */
  volume: number
  keyboard: boolean
  tabs: boolean
  music: boolean
  /** Background music volume, 0-100. */
  musicVolume: number
  /** Lower the background music while a tab is playing sound (a video, a call). */
  duckMusic: boolean
  /** Where the background music comes from: the tracks of the mod chosen in `mods.music`, or an internet radio stream. */
  musicSource: 'mod' | 'radio'
  radioUrl: string
  radioName: string
}

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
  /** Hide the address bar (with the bookmarks and tool buttons); it slides in when the cursor reaches the edge. */
  autoHideAddressBar: boolean
  sounds: SoundSettings
  /** Which installed mod each part of the look and sound comes from; null keeps Lumo's own. Parts can come from different mods. */
  mods: ModSelection
  /**
   * Read-only, filled in by the main process: `theme` is then the mod's colors, not the user's own,
   * so the color pickers must not write it back.
   */
  themeFromMod?: boolean
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
  /** Started from a private tab: kept in memory only, and forgotten when the last private tab closes. */
  incognito?: boolean
}

export interface AnchorBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Sent to the address-bar overlay (see main/edgeOverlay.ts): slide in or out, from the top or the bottom edge. */
export interface EdgeState {
  open: boolean
  position: 'top' | 'bottom'
}

/** Sounds the UI plays. The `key-*` kinds also arrive from pages, where only the kind (never the key) is sent. */
export type SoundEvent =
  | 'tab-open'
  | 'tab-close'
  | 'key-letter'
  | 'key-space'
  | 'key-enter'
  | 'key-backspace'

export const KEY_SOUND_EVENTS: readonly SoundEvent[] = ['key-letter', 'key-space', 'key-enter', 'key-backspace']

/** An installed mod (Opera GX's mod manifest format), as listed in the settings. */
export interface ModInfo {
  id: string
  name: string
  author: string | null
  description: string | null
  version: string | null
  /** lumo-mod:// URL of the mod's icon. */
  icon: string | null
  hasMusic: boolean
  hasKeyboard: boolean
  hasTabSounds: boolean
  hasTheme: boolean
  hasWallpaper: boolean
}

/** A mod's wallpaper for the new tab page (an image, or a looping muted video with a still `poster`). */
export interface ModWallpaper {
  url: string
  video: boolean
  poster: string | null
  textColor: string | null
  textShadow: string | null
}

/** The audio files of a mod, as lumo-mod:// URLs; lists play in order. */
export interface ModSounds {
  music: string[]
  events: Partial<Record<SoundEvent, string[]>>
}

export interface ModInstallResult {
  ok: boolean
  mod?: ModInfo
  error?: string
  /** The user closed the file picker. */
  cancelled?: boolean
}

export const MOD_SCHEME = 'lumo-mod'

export const GX_STORE_URL = 'https://store.gx.me/mods/'
/** The page of one mod on the GX Store (not the list): /<lang>/mods/<id>/<slug>/. */
export const GX_STORE_MOD_PAGE = /^https:\/\/store\.gx\.me\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?mods\/[a-z0-9]+\/[^/?#]+/i
