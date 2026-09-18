import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TabSnapshot,
  MemorySnapshot,
  AiStatusPayload,
  Settings,
  Bookmark,
  DownloadItem,
  AlertDialogPayload,
  AnchorBounds
} from '@shared/ipc'
import TabStrip from './components/TabStrip'
import AddressBar from './components/AddressBar'
import TabManagerPanel from './components/TabManagerPanel'
import WindowControls from './components/WindowControls'
import BookmarksBar from './components/BookmarksBar'
import SettingsPage from './components/SettingsPage'
import NewTabPage from './components/NewTabPage'
import AlertModal from './components/AlertModal'
import ErrorBoundary from './components/ErrorBoundary'
import { lighten } from './lib/color'
import { animateValue } from './lib/animate'

const DEFAULT_SETTINGS: Settings = {
  memorySaverEnabled: true,
  idleSuspendMinutes: 10,
  tabMemoryBudgetMB: 400,
  showBookmarksBar: true,
  theme: { accent: '#2e6bff', danger: '#ff4d6a', bg: '#14151d' },
  hardwareAccelerationEnabled: true,
  autofillPasswordsEnabled: true,
  autoSavePasswordsEnabled: true
}

export default function App(): JSX.Element {
  const [tabs, setTabs] = useState<TabSnapshot[]>([])
  const [memory, setMemory] = useState<MemorySnapshot | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatusPayload>({ busy: false, message: null })
  const [managerOpen, setManagerOpen] = useState(false)
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiAnswer, setAiAnswer] = useState<string | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [toolbarHidden, setToolbarHidden] = useState(false)
  const [alertQueue, setAlertQueue] = useState<AlertDialogPayload[]>([])
  const toolbarRef = useRef<HTMLDivElement>(null)
  const panelWidthRef = useRef(0)

  useEffect(() => {
    const offTabs = window.lumo.onTabsUpdated(setTabs)
    const offMemory = window.lumo.onMemoryUpdated(setMemory)
    const offAi = window.lumo.onAiStatus(setAiStatus)
    const offMaximized = window.lumo.onWindowMaximizedChanged(setIsMaximized)
    const offBookmarks = window.lumo.onBookmarksUpdated(setBookmarks)
    const offDownloads = window.lumo.onDownloadsUpdated(setDownloads)
    const offFullscreen = window.lumo.onFullscreenChanged(setToolbarHidden)
    const offAlert = window.lumo.onAlertDialog((payload) => setAlertQueue((q) => [...q, payload]))
    const offFlyout = window.lumo.onDownloadsFlyoutChanged(setDownloadsOpen)
    const offSettingsFlyout = window.lumo.onSettingsFlyoutChanged(setSettingsOpen)
    void window.lumo.getSettings().then(setSettingsState)
    void window.lumo.listBookmarks().then(setBookmarks)
    void window.lumo.listDownloads().then(setDownloads)
    return () => {
      offTabs()
      offMemory()
      offAi()
      offMaximized()
      offBookmarks()
      offDownloads()
      offFullscreen()
      offAlert()
      offFlyout()
      offSettingsFlyout()
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', settings.theme.accent)
    root.style.setProperty('--danger', settings.theme.danger)
    root.style.setProperty('--bg', settings.theme.bg)
    root.style.setProperty('--bg-elevated', lighten(settings.theme.bg, 0.05))
    root.style.setProperty('--border', lighten(settings.theme.bg, 0.14))
  }, [settings.theme])

  // Reports the toolbar's real height to the main process so the page view is positioned right below it.
  useEffect(() => {
    if (toolbarHidden) {
      window.lumo.setToolbarHeight(0)
      return
    }
    const el = toolbarRef.current
    if (!el) return
    const report = (): void => window.lumo.setToolbarHeight(el.offsetHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [managerOpen, aiStatus.busy, aiAnswer, settings.showBookmarksBar, toolbarHidden])

  // Tabs & RAM reserves real width from the page so the user can inspect and organize tabs.
  // Downloads now floats over the page as a popover without resizing the web contents.
  useEffect(() => {
    const target = managerOpen ? 380 : 0
    return animateValue(panelWidthRef.current, target, 220, (value) => {
      panelWidthRef.current = value
      window.lumo.setPanelWidth(Math.round(value))
    })
  }, [managerOpen])

  // A page's alert() is a real blocking dialog — hide the native view while it's up so our own
  // styled modal (which native views would otherwise always paint over) is visible and usable.
  useEffect(() => {
    window.lumo.setModalActive(alertQueue.length > 0)
  }, [alertQueue.length])

  const toggleManager = useCallback(() => {
    setManagerOpen((v) => !v)
  }, [])
  const handleToggleDownloads = useCallback((bounds?: AnchorBounds) => {
    window.lumo.toggleDownloadsFlyout(bounds)
  }, [])
  const handleToggleSettings = useCallback((bounds?: AnchorBounds) => {
    window.lumo.toggleSettingsFlyout(bounds)
  }, [])

  const activeTab = tabs.find((t) => t.isActive) ?? null
  const isInternal = (url: string): boolean => url.startsWith('lumo://')

  const openInternal = useCallback(
    (url: string) => {
      const existing = tabs.find((t) => t.url === url)
      if (existing) void window.lumo.activateTab(existing.id)
      else void window.lumo.createTab(url)
    },
    [tabs]
  )

  useEffect(() => {
    const off = window.lumo.onOpenFullSettings(() => {
      openInternal('lumo://settings')
    })
    return () => {
      off()
    }
  }, [openInternal])

  const updateSettings = useCallback((partial: Partial<Settings>) => {
    void window.lumo.setSettings(partial).then(setSettingsState)
  }, [])

  const newTab = useCallback(() => void window.lumo.createTab(), [])
  const closeTab = useCallback((id: string) => void window.lumo.closeTab(id), [])
  const activateTab = useCallback((id: string) => void window.lumo.activateTab(id), [])
  const navigate = useCallback(
    (input: string) => {
      if (!activeTab) return
      setAiAnswer(null)
      void window.lumo.navigate(activeTab.id, input).then((result) => {
        if (result.kind === 'answer') setAiAnswer(result.detail)
      })
    },
    [activeTab]
  )
  const goBack = useCallback(() => activeTab && void window.lumo.goBack(activeTab.id), [activeTab])
  const goForward = useCallback(
    () => activeTab && void window.lumo.goForward(activeTab.id),
    [activeTab]
  )
  const reload = useCallback(() => activeTab && void window.lumo.reload(activeTab.id), [activeTab])
  const inspect = useCallback(
    () => activeTab && void window.lumo.toggleDevTools(activeTab.id),
    [activeTab]
  )

  const isBookmarked = !!activeTab && bookmarks.some((b) => b.url === activeTab.url)
  const toggleBookmark = useCallback(() => {
    if (!activeTab) return
    const existing = bookmarks.find((b) => b.url === activeTab.url)
    if (existing) void window.lumo.removeBookmark(existing.id)
    else
      void window.lumo.addBookmark({
        title: activeTab.title || activeTab.domain,
        url: activeTab.url,
        favicon: activeTab.favicon
      })
  }, [activeTab, bookmarks])

  return (
    <div className="app">
      <div className={`toolbar ${toolbarHidden ? 'toolbar--collapsed' : ''}`} ref={toolbarRef}>
        <ErrorBoundary>
        <div className="toolbar-row" onDoubleClick={() => window.lumo.toggleMaximizeWindow()}>
          <TabStrip
            tabs={tabs}
            onActivate={activateTab}
            onClose={closeTab}
            onNewTab={newTab}
            onToggleManager={toggleManager}
            managerOpen={managerOpen}
          />
          <WindowControls isMaximized={isMaximized} />
        </div>
        <AddressBar
          activeTab={activeTab}
          onNavigate={navigate}
          onBack={goBack}
          onForward={goForward}
          onReload={reload}
          onInspect={inspect}
          isBookmarked={isBookmarked}
          onToggleBookmark={toggleBookmark}
          aiStatus={aiStatus}
          downloads={downloads}
          downloadsOpen={downloadsOpen}
          onToggleDownloads={handleToggleDownloads}
          settingsOpen={settingsOpen}
          onToggleSettings={handleToggleSettings}
        />
        {settings.showBookmarksBar && (
          <BookmarksBar
            bookmarks={bookmarks}
            onOpen={(url) => navigate(url)}
            onOpenNewTab={(url) => void window.lumo.createTab(url, false)}
          />
        )}
        {aiAnswer && (
          <div className="ai-answer">
            <span>{aiAnswer}</span>
            <button onClick={() => setAiAnswer(null)}>×</button>
          </div>
        )}
        </ErrorBoundary>
        <div className={`load-bar ${activeTab?.loading ? 'load-bar--active' : ''}`}>
          <div className="load-bar__sweep" />
        </div>
      </div>

      <div className="body">
        <ErrorBoundary>
        <TabManagerPanel
          open={managerOpen}
          tabs={tabs}
          memory={memory}
          aiStatus={aiStatus}
          onActivate={activateTab}
          onClose={closeTab}
          onSuspend={(id) => window.lumo.suspendTab(id)}
          onResume={(id) => window.lumo.resumeTab(id)}
          onOrganize={() => window.lumo.organizeTabs()}
          onDismiss={() => setManagerOpen(false)}
          onSaveSettings={updateSettings}
        />

        {activeTab && isInternal(activeTab.url) ? (
          <div className="webview-slot webview-slot--internal">
            {activeTab.url === 'lumo://settings' && (
              <SettingsPage settings={settings} onChange={updateSettings} />
            )}
            {activeTab.url === 'lumo://newtab' && (
              <NewTabPage
                bookmarks={bookmarks}
                totalMemoryMB={memory?.totalMB ?? null}
                onNavigate={navigate}
                onOpenNewTab={(url) => void window.lumo.createTab(url, false)}
              />
            )}
          </div>
        ) : (
          <div className="webview-slot" />
        )}
        </ErrorBoundary>
      </div>

      {alertQueue[0] && (
        <AlertModal alert={alertQueue[0]} onDismiss={() => setAlertQueue((q) => q.slice(1))} />
      )}
    </div>
  )
}
