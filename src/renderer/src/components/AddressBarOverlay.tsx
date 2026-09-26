import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiStatusPayload, Bookmark, DownloadItem, Settings, TabSnapshot } from '@shared/ipc'
import AddressBar from './AddressBar'
import BookmarksBar from './BookmarksBar'
import ToolButtons from './ToolButtons'
import { useTheme } from '../lib/useTheme'

/**
 * The auto-hiding address bar (with bookmarks and the tool buttons). It slides in over the page when the
 * cursor reaches the top of the window — or, in the bottom tab layout, the tab strip at the bottom — and
 * stays while the input has focus (see main/edgeOverlay.ts). It is its own web contents, so it keeps its
 * own copy of the UI state.
 */
export default function AddressBarOverlay(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [tabs, setTabs] = useState<TabSnapshot[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [aiStatus, setAiStatus] = useState<AiStatusPayload>({ busy: false, message: null })
  const [aiAnswer, setAiAnswer] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  useTheme()

  useEffect(() => {
    const offs = [
      window.lumo.onEdgeState((s) => setOpen(s.open)),
      window.lumo.onTabsUpdated(setTabs),
      window.lumo.onSettingsChanged(setSettings),
      window.lumo.onBookmarksUpdated(setBookmarks),
      window.lumo.onDownloadsUpdated(setDownloads),
      window.lumo.onAiStatus(setAiStatus)
    ]
    void window.lumo.getSettings().then(setSettings)
    void window.lumo.listBookmarks().then(setBookmarks)
    void window.lumo.listDownloads().then(setDownloads)
    return () => offs.forEach((off) => off())
  }, [])

  // The overlay is as tall as its content (answer strip, bookmarks and the address row); main sizes the view to match.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let last = 0
    const report = (): void => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      if (h === last || h === 0) return
      last = h
      window.lumo.setAddressBarHeight(h)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const activeTab = tabs.find((t) => t.isActive) ?? null
  const position = settings?.tabLayout === 'bottom' ? 'bottom' : 'top'
  // With a sidebar the tool buttons live in the sidebar footer, as they do with the bar shown.
  const sidebarLayout = settings?.tabLayout === 'left' || settings?.tabLayout === 'right'

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
    <div className="edge-wrap">
      <div
        ref={wrapRef}
        className={`edge-bar edge-bar--${position} ${open ? 'edge-bar--open' : ''}`}
        // While the input has focus the user is typing: main keeps the bar up until focus leaves.
        onFocus={() => window.lumo.setAddressBarFocus(true)}
        onBlur={() => window.lumo.setAddressBarFocus(false)}
      >
        {aiAnswer && (
          <div className="ai-answer">
            <span>{aiAnswer}</span>
            <button onClick={() => setAiAnswer(null)}>×</button>
          </div>
        )}
        {settings?.showBookmarksBar && (
          <BookmarksBar
            bookmarks={bookmarks}
            onOpen={navigate}
            onOpenNewTab={(url) => void window.lumo.createTab(url, false)}
          />
        )}
        <AddressBar
          activeTab={activeTab}
          onNavigate={navigate}
          onBack={() => activeTab && void window.lumo.goBack(activeTab.id)}
          onForward={() => activeTab && void window.lumo.goForward(activeTab.id)}
          onReload={() => activeTab && void window.lumo.reload(activeTab.id)}
          isBookmarked={isBookmarked}
          onToggleBookmark={toggleBookmark}
          aiStatus={aiStatus}
          tools={
            sidebarLayout ? undefined : (
            <ToolButtons
              onInspect={() => activeTab && void window.lumo.toggleDevTools(activeTab.id)}
              downloads={downloads}
              downloadsOpen={false}
              onToggleDownloads={(bounds) => window.lumo.toggleDownloadsFlyout(bounds)}
              settingsOpen={false}
              onToggleSettings={(bounds) => window.lumo.toggleSettingsFlyout(bounds)}
            />
            )
          }
        />
      </div>
    </div>
  )
}
