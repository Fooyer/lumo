import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TabSnapshot,
  MemorySnapshot,
  AiStatusPayload,
  Settings,
  Bookmark,
  DownloadItem,
  AlertDialogPayload,
  CertWarningPayload,
  AnchorBounds,
  UpdateStatus
} from '@shared/ipc'
import TabStrip from './components/TabStrip'
import TabSidebar from './components/TabSidebar'
import AddressBar from './components/AddressBar'
import ToolButtons from './components/ToolButtons'
import WindowControls from './components/WindowControls'
import BookmarksBar from './components/BookmarksBar'
import SettingsPage from './components/SettingsPage'
import NewTabPage from './components/NewTabPage'
import HistoryPage from './components/HistoryPage'
import DownloadsPage from './components/DownloadsPage'
import AlertModal from './components/AlertModal'
import CertWarningModal from './components/CertWarningModal'
import ErrorBoundary from './components/ErrorBoundary'
import { lighten } from './lib/color'
import { isInteractiveTarget } from './lib/interactive'

const DEFAULT_SETTINGS: Settings = {
  memorySaverEnabled: true,
  idleSuspendMinutes: 10,
  tabMemoryBudgetMB: 400,
  showBookmarksBar: true,
  theme: { accent: '#2e6bff', danger: '#ff4d6a', bg: '#14151d' },
  hardwareAccelerationEnabled: true,
  tabLayout: 'top',
  sidebarCollapsed: false,
  restoreSession: true,
  autoUpdate: true,
  autoHideAddressBar: false
}

export default function App(): JSX.Element {
  const [tabs, setTabs] = useState<TabSnapshot[]>([])
  const [memory, setMemory] = useState<MemorySnapshot | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatusPayload>({ busy: false, message: null })
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiAnswer, setAiAnswer] = useState<string | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [toolbarHidden, setToolbarHidden] = useState(false)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [alertQueue, setAlertQueue] = useState<AlertDialogPayload[]>([])
  const [certQueue, setCertQueue] = useState<CertWarningPayload[]>([])
  const slotRef = useRef<HTMLDivElement>(null)
  const lastBoundsRef = useRef('')

  useEffect(() => {
    const offTabs = window.lumo.onTabsUpdated(setTabs)
    const offMemory = window.lumo.onMemoryUpdated(setMemory)
    const offAi = window.lumo.onAiStatus(setAiStatus)
    const offMaximized = window.lumo.onWindowMaximizedChanged(setIsMaximized)
    const offBookmarks = window.lumo.onBookmarksUpdated(setBookmarks)
    const offDownloads = window.lumo.onDownloadsUpdated(setDownloads)
    const offFullscreen = window.lumo.onFullscreenChanged(setToolbarHidden)
    const offAlert = window.lumo.onAlertDialog((payload) => setAlertQueue((q) => [...q, payload]))
    const offSettings = window.lumo.onSettingsChanged(setSettingsState)
    const offCert =window.lumo.onCertWarning((payload) => setCertQueue((q) => [...q, payload]))
    const offUpdate = window.lumo.onUpdateStatus(setUpdate)
    const offFlyout = window.lumo.onDownloadsFlyoutChanged(setDownloadsOpen)
    const offSettingsFlyout = window.lumo.onSettingsFlyoutChanged(setSettingsOpen)
    void window.lumo.getSettings().then(setSettingsState)
    void window.lumo.getUpdateStatus().then(setUpdate)
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
      offCert()
      offSettings()
      offUpdate()
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

  // The page views are native and sit on top of the UI, so the main process needs the exact area
  // the layout leaves for them. Measuring the slot itself keeps this right for every tab layout.
  // The layout/collapse/fullscreen deps re-report moves that don't change the slot's size (e.g. left <-> right).
  useEffect(() => {
    const el = slotRef.current
    if (!el) return
    const report = (): void => {
      const r = el.getBoundingClientRect()
      const bounds = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      }
      const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
      if (key === lastBoundsRef.current) return
      lastBoundsRef.current = key
      window.lumo.setContentBounds(bounds)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [settings.tabLayout, settings.sidebarCollapsed, toolbarHidden])

  // A page's alert() is a real blocking dialog — hide the native view while it's up so our own
  // styled modal (which native views would otherwise always paint over) is visible and usable.
  useEffect(() => {
    window.lumo.setModalActive(alertQueue.length + certQueue.length > 0)
  }, [alertQueue.length, certQueue.length])

  const answerCertWarning = useCallback((id: string, proceed: boolean) => {
    window.lumo.respondCertWarning(id, proceed)
    setCertQueue((q) => q.filter((w) => w.id !== id))
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

  const layout = settings.tabLayout
  // With a sidebar the top bar stays a single lean row (navigation + address + window controls) and
  // the tool buttons move to the sidebar footer.
  const sidebarLayout = layout === 'left' || layout === 'right'
  // With the address bar auto-hidden it lives in an overlay (AddressBarOverlay), not in the toolbar.
  const hideBar = settings.autoHideAddressBar
  const tools = (
    <ToolButtons
      onInspect={inspect}
      downloads={downloads}
      downloadsOpen={downloadsOpen}
      onToggleDownloads={handleToggleDownloads}
      settingsOpen={settingsOpen}
      onToggleSettings={handleToggleSettings}
    />
  )
  const addressBar = (
    <AddressBar
      activeTab={activeTab}
      onNavigate={navigate}
      onBack={goBack}
      onForward={goForward}
      onReload={reload}
      isBookmarked={isBookmarked}
      onToggleBookmark={toggleBookmark}
      aiStatus={aiStatus}
      tools={sidebarLayout ? undefined : tools}
      inline={sidebarLayout}
    />
  )
  const showSidebar = !toolbarHidden && (layout === 'left' || layout === 'right')
  const sidebar = showSidebar ? (
    <ErrorBoundary>
      <TabSidebar
        side={layout === 'right' ? 'right' : 'left'}
        tabs={tabs}
        collapsed={settings.sidebarCollapsed}
        onToggleCollapsed={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
        onActivate={activateTab}
        onClose={closeTab}
        onNewTab={newTab}
        tools={tools}
      />
    </ErrorBoundary>
  ) : null

  return (
    <div className={`app app--${layout}`}>
      <div className={`toolbar ${toolbarHidden ? 'toolbar--collapsed' : ''}`}>
        <ErrorBoundary>
        <div
          className="toolbar-row"
          onDoubleClick={(e) => {
            // Only empty space maximizes: double-clicking a tab or a button must not resize the window.
            if (!isInteractiveTarget(e.target)) window.lumo.toggleMaximizeWindow()
          }}
        >
          {layout === 'top' ? (
            <TabStrip tabs={tabs} onActivate={activateTab} onClose={closeTab} onNewTab={newTab} />
          ) : sidebarLayout && !hideBar ? (
            addressBar
          ) : (
            <div className="toolbar-row__brand">Lumo</div>
          )}
          <WindowControls isMaximized={isMaximized} />
        </div>
        {!sidebarLayout && layout !== 'bottom' && !hideBar && addressBar}
        {settings.showBookmarksBar && !hideBar && (
          <BookmarksBar
            bookmarks={bookmarks}
            onOpen={(url) => navigate(url)}
            onOpenNewTab={(url) => void window.lumo.createTab(url, false)}
          />
        )}
        {update?.state === 'ready' && !updateDismissed && (
          <div className="ai-answer update-banner">
            <span>O Lumo {update.version} foi baixado e está pronto para instalar.</span>
            <div className="update-banner__actions">
              <button className="update-banner__install" onClick={() => window.lumo.installUpdate()}>
                Reiniciar e atualizar
              </button>
              <button onClick={() => setUpdateDismissed(true)} title="Depois">
                ×
              </button>
            </div>
          </div>
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
        {showSidebar && layout === 'left' && sidebar}
        <div
          ref={slotRef}
          className={`webview-slot ${activeTab && isInternal(activeTab.url) ? 'webview-slot--internal' : ''}`}
        >
          <ErrorBoundary>
            {activeTab?.url === 'lumo://settings' && (
              <SettingsPage settings={settings} onChange={updateSettings} memory={memory} tabs={tabs} />
            )}
            {activeTab?.url === 'lumo://history' && (
              <HistoryPage
                onOpen={navigate}
                onOpenNewTab={(url) => void window.lumo.createTab(url, false)}
              />
            )}
            {activeTab?.url === 'lumo://downloads' && <DownloadsPage downloads={downloads} />}
            {activeTab?.url === 'lumo://newtab' && (
              <NewTabPage
                bookmarks={bookmarks}
                totalMemoryMB={memory?.totalMB ?? null}
                onNavigate={navigate}
                onOpenNewTab={(url) => void window.lumo.createTab(url, false)}
              />
            )}
          </ErrorBoundary>
        </div>
        {showSidebar && layout === 'right' && sidebar}
      </div>

      {!toolbarHidden && layout === 'bottom' && (
        <div className="tabbar-bottom">
          <TabStrip tabs={tabs} onActivate={activateTab} onClose={closeTab} onNewTab={newTab} />
          {!hideBar && addressBar}
        </div>
      )}

      {certQueue[0] ? (
        <CertWarningModal
          warning={certQueue[0]}
          onBack={() => answerCertWarning(certQueue[0].id, false)}
          onProceed={() => answerCertWarning(certQueue[0].id, true)}
        />
      ) : (
        alertQueue[0] && (
          <AlertModal alert={alertQueue[0]} onDismiss={() => setAlertQueue((q) => q.slice(1))} />
        )
      )}
    </div>
  )
}
