import {
  BrowserWindow,
  WebContentsView,
  Rectangle,
  Menu,
  MenuItemConstructorOptions,
  clipboard,
  Input
} from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { TabSnapshot } from '../shared/ipc'
import { resolveNavigationIntent, suggestTabGroups } from './opencode'

const DEFAULT_NEW_TAB_URL = 'lumo://newtab'
const CLOSED_STACK_LIMIT = 20
const SPLIT_GAP = 3
const MAX_SPLIT_SIZE = 3
const TAB_PRELOAD_PATH = join(__dirname, '../preload/tab.js')

export interface Tab {
  id: string
  url: string
  title: string
  favicon: string | null
  loading: boolean
  suspended: boolean
  lastActiveAt: number
  memoryMB: number | null
  view: WebContentsView | null
  aiGroup: { label: string; color: string } | null
  splitGroupId: string | null
  isFullscreen: boolean
}

export class TabManager {
  private tabs: Tab[] = []
  private activeId: string | null = null
  private toolbarHeight = 0
  private panelWidth = 0
  private closedStack: { url: string }[] = []
  private groups = new Map<string, string[]>()
  private currentlyVisibleIds: string[] = []
  private hiddenForModal = false
  private toolbarPeek = false
  private onChange: () => void = () => {}
  private aiBusyListener: (busy: boolean, message: string | null) => void = () => {}
  private fullscreenListener: (hidden: boolean) => void = () => {}

  constructor(private win: BrowserWindow) {
    win.on('resize', () => this.reflowVisible())
  }

  setOnChange(cb: () => void): void {
    this.onChange = cb
  }

  setOnAiBusy(cb: (busy: boolean, message: string | null) => void): void {
    this.aiBusyListener = cb
  }

  setOnFullscreenChange(cb: (hidden: boolean) => void): void {
    this.fullscreenListener = cb
  }

  setToolbarHeight(px: number): void {
    this.toolbarHeight = px
    this.reflowVisible()
  }

  setPanelWidth(px: number): void {
    this.panelWidth = px
    this.reflowVisible()
  }

  private contentBounds(): Rectangle {
    const [width, height] = this.win.getContentSize()
    return {
      x: 0,
      y: this.toolbarHeight,
      width: Math.max(0, width - this.panelWidth),
      height: Math.max(0, height - this.toolbarHeight)
    }
  }

  private getActive(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId)
  }

  getActiveId(): string | null {
    return this.activeId
  }


  private get(id: string): Tab | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  list(): Tab[] {
    return this.tabs
  }

  createView(tab: Tab, url: string): void {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: TAB_PRELOAD_PATH,
        // Some sites (old frame-based apps especially) call alert()/submit forms from inside
        // iframes, not the top document — this makes our preload (and its alert override) run
        // in every frame, not just the main one.
        nodeIntegrationInSubFrames: true
      }
    })
    tab.view = view
    tab.suspended = false

    const wc = view.webContents
    wc.on('did-start-loading', () => {
      tab.loading = true
      this.onChange()
    })
    wc.on('did-stop-loading', () => {
      tab.loading = false
      this.onChange()
    })
    wc.on('page-title-updated', (_e, title) => {
      tab.title = title
      this.onChange()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null
      this.onChange()
    })
    wc.on('did-navigate', (_e, navUrl) => {
      tab.url = navUrl
      this.onChange()
    })
    wc.on('did-navigate-in-page', (_e, navUrl) => {
      tab.url = navUrl
      this.onChange()
    })
    wc.on('did-fail-load', (_e, code, desc) => {
      if (code === -3) return
      tab.loading = false
      tab.title = `Falha ao carregar (${desc})`
      this.onChange()
    })
    wc.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F12') {
        this.toggleDevTools(tab.id)
        return
      }
      this.handleShortcut(input, tab.id)
    })
    wc.on('context-menu', (_e, params) => this.showPageContextMenu(wc, params))
    wc.on('focus', () => this.setFocusedPane(tab.id))
    wc.on('enter-html-full-screen', () => {
      tab.isFullscreen = true
      this.toolbarPeek = false
      this.syncFullscreenState()
    })
    wc.on('leave-html-full-screen', () => {
      tab.isFullscreen = false
      this.toolbarPeek = false
      this.syncFullscreenState()
    })
    wc.setWindowOpenHandler((details) => {
      const size = parsePopupFeatures(details.features)
      const isPopup = details.disposition === 'new-window' && !!size
      if (isPopup) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: size!.width ?? 480,
            height: size!.height ?? 640,
            autoHideMenuBar: true,
            backgroundColor: '#14151d',
            webPreferences: {
              contextIsolation: true,
              sandbox: true,
              preload: TAB_PRELOAD_PATH,
              nodeIntegrationInSubFrames: true
            }
          }
        }
      }

      // Deferred to the next tick: creating/activating a tab synchronously here — while this very
      // webContents is still mid-dispatch of its own window-open event — can tear down its view
      // (e.g. if it's the currently active tab being swapped out) out from under that dispatch.
      const activate = details.disposition !== 'background-tab'
      setImmediate(() => this.create(details.url, { activate }))
      return { action: 'deny' }
    })
    wc.on('did-create-window', (childWindow) => wireChildWindow(childWindow))

    wc.loadURL(url)
  }

  toggleDevTools(id: string): void {
    const wc = this.get(id)?.view?.webContents
    if (!wc) return
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'right' })
  }

  private syncFullscreenState(): void {
    const active = this.getActive()
    const hidden = !!active?.isFullscreen && !this.toolbarPeek
    this.fullscreenListener(hidden)
  }

  toggleToolbarPeek(): void {
    if (!this.getActive()?.isFullscreen) return
    this.toolbarPeek = !this.toolbarPeek
    this.syncFullscreenState()
  }

  setFocusedPane(id: string): void {
    if (this.activeId === id) return
    if (!this.currentlyVisibleIds.includes(id)) return
    this.activeId = id
    this.onChange()
  }

  handleShortcut(input: Pick<Input, 'key' | 'control' | 'meta' | 'shift'>, tabId?: string): boolean {
    if (input.key === 'F11') {
      this.toggleToolbarPeek()
      return true
    }
    const ctrl = input.control || input.meta
    if (!ctrl) return false
    const key = input.key.toLowerCase()
    if (input.shift && key === 't') {
      this.reopenLastClosed()
      return true
    }
    if (key === 't') {
      this.create()
      return true
    }
    if (key === 'w') {
      const id = tabId ?? this.activeId
      if (id) this.close(id)
      return true
    }
    return false
  }

  private showPageContextMenu(wc: Electron.WebContents, params: Electron.ContextMenuParams): void {
    const items: MenuItemConstructorOptions[] = []

    if (params.linkURL) {
      items.push({ label: 'Abrir link em nova aba', click: () => this.create(params.linkURL, { activate: false }) })
      items.push({ label: 'Copiar link', click: () => clipboard.writeText(params.linkURL) })
      items.push({ type: 'separator' })
    }

    if (params.hasImageContents) {
      items.push({
        label: 'Abrir imagem em nova aba',
        click: () => this.create(params.srcURL, { activate: false })
      })
      items.push({ label: 'Salvar imagem como…', click: () => wc.downloadURL(params.srcURL) })
      items.push({ label: 'Copiar imagem', click: () => wc.copyImageAt(params.x, params.y) })
      items.push({ type: 'separator' })
    }

    items.push(...buildEditContextItems(params, (query) => this.create(searchUrl(query))))

    items.push({
      label: 'Voltar',
      enabled: wc.navigationHistory.canGoBack(),
      click: () => wc.navigationHistory.goBack()
    })
    items.push({
      label: 'Avançar',
      enabled: wc.navigationHistory.canGoForward(),
      click: () => wc.navigationHistory.goForward()
    })
    items.push({ label: 'Recarregar', click: () => wc.reload() })
    items.push({ type: 'separator' })
    items.push({
      label: 'Inspecionar elemento',
      click: () => {
        wc.openDevTools({ mode: 'right' })
        wc.inspectElement(params.x, params.y)
      }
    })

    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  showTabContextMenu(id: string): void {
    const tab = this.get(id)
    if (!tab) return
    const items: MenuItemConstructorOptions[] = [
      { label: 'Nova aba', click: () => this.create() },
      { label: 'Recarregar', click: () => this.reload(id) },
      { label: 'Duplicar aba', click: () => this.duplicate(id) },
      { type: 'separator' }
    ]
    if (tab.splitGroupId) {
      items.push({ label: 'Remover da divisão de tela', click: () => this.removeFromSplit(id) })
      items.push({ type: 'separator' })
    }
    items.push(
      { label: 'Fechar aba', click: () => this.close(id) },
      { label: 'Fechar outras abas', click: () => this.closeOthers(id), enabled: this.tabs.length > 1 },
      { label: 'Fechar abas à direita', click: () => this.closeToRight(id) },
      { type: 'separator' },
      {
        label: 'Reabrir aba fechada',
        click: () => this.reopenLastClosed(),
        enabled: this.closedStack.length > 0
      }
    )
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  create(rawUrl?: string, options: { activate?: boolean } = {}): string {
    const { activate = true } = options
    const id = randomUUID()
    const url = normalizeUrlOrNull(rawUrl || '') || DEFAULT_NEW_TAB_URL
    const internal = isInternalUrl(url)
    const tab: Tab = {
      id,
      url,
      title: internal ? internalTitle(url) : 'Nova aba',
      favicon: null,
      loading: !internal,
      suspended: false,
      lastActiveAt: Date.now(),
      memoryMB: null,
      view: null,
      aiGroup: null,
      splitGroupId: null,
      isFullscreen: false
    }
    this.tabs.push(tab)
    if (!internal) this.createView(tab, url)
    if (activate) this.activate(id)
    else this.onChange()
    return id
  }

  duplicate(id: string): void {
    const tab = this.get(id)
    if (tab) this.create(tab.url)
  }

  activate(id: string): void {
    const target = this.get(id)
    if (!target) return
    this.activeId = id
    this.toolbarPeek = false
    this.refreshVisibility()
    this.syncFullscreenState()
    this.onChange()
  }

  /** Recomputes which tab(s) should be visible based on the active tab's split group, and reflows bounds. */
  private refreshVisibility(): void {
    const active = this.getActive()
    const newVisibleIds = active ? (active.splitGroupId ? this.groups.get(active.splitGroupId) ?? [active.id] : [active.id]) : []

    for (const id of this.currentlyVisibleIds) {
      if (!newVisibleIds.includes(id)) {
        const t = this.get(id)
        if (t?.view) this.win.contentView.removeChildView(t.view)
      }
    }

    this.currentlyVisibleIds = newVisibleIds

    for (const id of newVisibleIds) {
      const t = this.get(id)
      if (!t) continue
      t.lastActiveAt = Date.now()
      if (!isInternalUrl(t.url) && (t.suspended || !t.view)) this.createView(t, t.url)
    }

    this.reflowVisible()
  }

  private reflowVisible(): void {
    if (this.hiddenForModal) return
    const base = this.contentBounds()
    const rects = layoutRects(this.currentlyVisibleIds.length, base)
    this.currentlyVisibleIds.forEach((id, i) => {
      const t = this.get(id)
      if (!t?.view) return
      if (!this.win.contentView.children.includes(t.view)) this.win.contentView.addChildView(t.view)
      t.view.setBounds(rects[i])
    })
  }

  /** Temporarily detaches the visible page view(s) so a blocking in-app dialog (e.g. a page's
   * alert()) can be seen and interacted with — native views always paint above our own UI. */
  setModalActive(active: boolean): void {
    if (active === this.hiddenForModal) return
    this.hiddenForModal = active
    if (active) {
      for (const id of this.currentlyVisibleIds) {
        const t = this.get(id)
        if (t?.view) this.win.contentView.removeChildView(t.view)
      }
    } else {
      this.reflowVisible()
    }
  }

  close(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const [tab] = this.tabs.splice(idx, 1)

    if (tab.splitGroupId) this.leaveGroup(tab.id, tab.splitGroupId)
    if (tab.view) {
      this.win.contentView.removeChildView(tab.view)
      tab.view.webContents.close()
    }
    if (!isInternalUrl(tab.url)) {
      this.closedStack.push({ url: tab.url })
      if (this.closedStack.length > CLOSED_STACK_LIMIT) this.closedStack.shift()
    }

    if (this.activeId === id) {
      this.activeId = null
      const next = this.tabs[idx] || this.tabs[idx - 1]
      if (next) this.activate(next.id)
      else this.create()
      return
    }

    this.refreshVisibility()
    this.onChange()
  }

  closeOthers(id: string): void {
    for (const t of [...this.tabs]) if (t.id !== id) this.close(t.id)
  }

  closeToRight(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    for (const t of this.tabs.slice(idx + 1)) this.close(t.id)
  }

  reopenLastClosed(): void {
    const last = this.closedStack.pop()
    if (last) this.create(last.url)
  }

  /**
   * Moves `draggedId` to sit immediately before `beforeId` (or to the end when null).
   * If both tabs share a split group, this only reorders their position *within* that
   * group (deciding which pane sits left/right/top/bottom) instead of leaving it.
   */
  reorder(draggedId: string, beforeId: string | null): void {
    const dragged = this.get(draggedId)
    if (!dragged || draggedId === beforeId) return

    const targetGroupId = beforeId ? this.get(beforeId)?.splitGroupId ?? null : null
    const stayingInGroup = !!dragged.splitGroupId && dragged.splitGroupId === targetGroupId

    if (stayingInGroup) {
      const members = this.groups.get(dragged.splitGroupId!)
      if (members) {
        const filtered = members.filter((m) => m !== draggedId)
        const insertAt = beforeId ? filtered.indexOf(beforeId) : filtered.length
        filtered.splice(insertAt === -1 ? filtered.length : insertAt, 0, draggedId)
        this.groups.set(dragged.splitGroupId!, filtered)
      }
    } else if (dragged.splitGroupId) {
      this.leaveGroup(draggedId, dragged.splitGroupId)
    }

    const fromIdx = this.tabs.findIndex((t) => t.id === draggedId)
    if (fromIdx === -1) return
    this.tabs.splice(fromIdx, 1)

    let toIdx = beforeId ? this.tabs.findIndex((t) => t.id === beforeId) : this.tabs.length
    if (toIdx === -1) toIdx = this.tabs.length
    this.tabs.splice(toIdx, 0, dragged)

    this.refreshVisibility()
    this.onChange()
  }

  /** Combines `draggedId` into the same split view as `targetId` (creating a group if needed, up to 3 tabs). */
  combineSplit(draggedId: string, targetId: string): void {
    if (draggedId === targetId) return
    const dragged = this.get(draggedId)
    const target = this.get(targetId)
    if (!dragged || !target) return
    if (dragged.splitGroupId && dragged.splitGroupId === target.splitGroupId) return

    let groupId = target.splitGroupId
    if (groupId) {
      const members = this.groups.get(groupId)
      if (!members || members.length >= MAX_SPLIT_SIZE) return
      if (dragged.splitGroupId) this.leaveGroup(draggedId, dragged.splitGroupId)
      members.push(draggedId)
      dragged.splitGroupId = groupId
    } else {
      if (dragged.splitGroupId) this.leaveGroup(draggedId, dragged.splitGroupId)
      groupId = randomUUID()
      this.groups.set(groupId, [targetId, draggedId])
      target.splitGroupId = groupId
      dragged.splitGroupId = groupId
    }

    this.makeGroupContiguous(groupId)
    this.activate(targetId)
  }

  removeFromSplit(id: string): void {
    const tab = this.get(id)
    if (!tab?.splitGroupId) return
    this.leaveGroup(id, tab.splitGroupId)
    this.refreshVisibility()
    this.onChange()
  }

  private leaveGroup(tabId: string, groupId: string): void {
    const members = this.groups.get(groupId)
    const tab = this.get(tabId)
    if (tab) tab.splitGroupId = null
    if (!members) return

    const updated = members.filter((m) => m !== tabId)
    if (updated.length <= 1) {
      for (const m of updated) {
        const t = this.get(m)
        if (t) t.splitGroupId = null
      }
      this.groups.delete(groupId)
    } else {
      this.groups.set(groupId, updated)
    }
  }

  /** Reorders the main tab list so a split group's members sit next to each other, at the position of the earliest member. */
  private makeGroupContiguous(groupId: string): void {
    const order = this.groups.get(groupId)
    if (!order) return
    const indices = order.map((id) => this.tabs.findIndex((t) => t.id === id))
    const insertAt = Math.min(...indices)
    const members = order.map((id) => this.get(id)!).filter(Boolean)
    this.tabs = this.tabs.filter((t) => !order.includes(t.id))
    this.tabs.splice(insertAt, 0, ...members)
  }

  goBack(id: string): void {
    this.get(id)?.view?.webContents.navigationHistory.goBack()
  }

  goForward(id: string): void {
    this.get(id)?.view?.webContents.navigationHistory.goForward()
  }

  reload(id: string): void {
    this.get(id)?.view?.webContents.reload()
  }

  suspend(id: string): void {
    const tab = this.get(id)
    if (!tab || tab.suspended || !tab.view || this.currentlyVisibleIds.includes(id)) return
    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    tab.view = null
    tab.suspended = true
    tab.memoryMB = null
    this.onChange()
  }

  resume(id: string): void {
    const tab = this.get(id)
    if (!tab || !tab.suspended) return
    if (tab.id === this.activeId) {
      this.activate(id)
    } else {
      this.createView(tab, tab.url)
    }
  }

  updateMemory(readings: Map<string, number>): void {
    for (const tab of this.tabs) {
      const mb = readings.get(tab.id)
      if (mb !== undefined) tab.memoryMB = mb
    }
    this.onChange()
  }

  idleCandidates(): Tab[] {
    return this.tabs.filter((t) => !t.suspended && !this.currentlyVisibleIds.includes(t.id))
  }

  async navigateSmart(id: string, input: string): Promise<{ kind: string; detail: string }> {
    const tab = this.get(id)
    if (!tab) return { kind: 'error', detail: 'aba não encontrada' }

    const direct = normalizeUrlOrNull(input)
    if (direct) {
      this.loadInTab(tab, direct)
      return { kind: 'navigate', detail: direct }
    }

    this.aiBusyListener(true, 'Pensando na sua busca…')
    try {
      const intent = await resolveNavigationIntent(input)
      if (intent.kind === 'navigate') {
        const url = normalizeUrlOrNull(intent.detail) || searchUrl(intent.detail)
        this.loadInTab(tab, url)
      } else if (intent.kind === 'search') {
        this.loadInTab(tab, searchUrl(intent.detail))
      }
      return intent
    } catch {
      this.loadInTab(tab, searchUrl(input))
      return { kind: 'search', detail: input }
    } finally {
      this.aiBusyListener(false, null)
    }
  }

  private loadInTab(tab: Tab, url: string): void {
    const wasInternal = isInternalUrl(tab.url)
    const willBeInternal = isInternalUrl(url)
    tab.url = url

    if (willBeInternal) {
      if (tab.view) {
        this.win.contentView.removeChildView(tab.view)
        tab.view.webContents.close()
        tab.view = null
      }
      tab.title = internalTitle(url)
      tab.loading = false
      if (this.currentlyVisibleIds.includes(tab.id)) this.reflowVisible()
    } else if (wasInternal || tab.suspended || !tab.view) {
      this.createView(tab, url)
      if (this.currentlyVisibleIds.includes(tab.id)) this.reflowVisible()
    } else {
      tab.view.webContents.loadURL(url)
    }
    this.onChange()
  }

  async organizeWithAi(): Promise<void> {
    this.aiBusyListener(true, 'Organizando suas abas…')
    try {
      const groups = await suggestTabGroups(
        this.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url }))
      )
      for (const tab of this.tabs) tab.aiGroup = null
      for (const group of groups) {
        for (const tabId of group.tabIds) {
          const tab = this.get(tabId)
          if (tab) tab.aiGroup = { label: group.label, color: group.color }
        }
      }
      this.onChange()
    } finally {
      this.aiBusyListener(false, null)
    }
  }

  snapshot(): TabSnapshot[] {
    return this.tabs.map((t) => {
      const internal = isInternalUrl(t.url)
      const domain = internal ? 'lumo' : domainOf(t.url)
      const group = t.aiGroup ?? {
        label: internal ? 'Lumo' : domain,
        color: internal ? '#8892a6' : colorForDomain(domain)
      }
      return {
        id: t.id,
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        loading: t.loading,
        suspended: t.suspended,
        isActive: t.id === this.activeId,
        domain,
        groupId: t.aiGroup ? `ai:${group.label}` : `domain:${domain}`,
        groupLabel: group.label,
        groupColor: group.color,
        splitGroupId: t.splitGroupId,
        memoryMB: t.memoryMB,
        lastActiveAt: t.lastActiveAt,
        canGoBack: navigationState(t.view).canGoBack,
        canGoForward: navigationState(t.view).canGoForward
      }
    })
  }
}

/** Guards against a view whose native webContents handle has already gone away (e.g. torn down
 * by a reentrant window-open) — reading navigationHistory on it would otherwise throw and take
 * the whole tab list down with it. */
function navigationState(view: WebContentsView | null): { canGoBack: boolean; canGoForward: boolean } {
  try {
    if (!view || !view.webContents || view.webContents.isDestroyed()) {
      return { canGoBack: false, canGoForward: false }
    }
    return {
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward()
    }
  } catch {
    return { canGoBack: false, canGoForward: false }
  }
}

function layoutRects(count: number, rect: Rectangle): Rectangle[] {
  if (count <= 1) return [rect]

  const leftW = Math.floor((rect.width - SPLIT_GAP) / 2)
  const rightW = rect.width - SPLIT_GAP - leftW
  const rightX = rect.x + leftW + SPLIT_GAP

  if (count === 2) {
    return [
      { x: rect.x, y: rect.y, width: leftW, height: rect.height },
      { x: rightX, y: rect.y, width: rightW, height: rect.height }
    ]
  }

  const topH = Math.floor((rect.height - SPLIT_GAP) / 2)
  const botH = rect.height - SPLIT_GAP - topH
  return [
    { x: rect.x, y: rect.y, width: leftW, height: rect.height },
    { x: rightX, y: rect.y, width: rightW, height: topH },
    { x: rightX, y: rect.y + topH + SPLIT_GAP, width: rightW, height: botH }
  ]
}

export function isInternalUrl(url: string): boolean {
  return url.startsWith('lumo://')
}

function internalTitle(url: string): string {
  if (url === 'lumo://settings') return 'Configurações'
  return 'Nova aba'
}

export function normalizeUrlOrNull(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`

  const hasSpace = /\s/.test(trimmed)
  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(trimmed)
  if (!hasSpace && looksLikeDomain) return `https://${trimmed}`

  return null
}

export function searchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'nova-aba'
  } catch {
    return 'nova-aba'
  }
}

const DOMAIN_PALETTE = ['#6C8CFF', '#33C2A3', '#F2A93B', '#E5636F', '#A56BE0', '#38B6E0', '#8BA33F']
export function colorForDomain(domain: string): string {
  let hash = 0
  for (let i = 0; i < domain.length; i++) hash = (hash * 31 + domain.charCodeAt(i)) >>> 0
  return DOMAIN_PALETTE[hash % DOMAIN_PALETTE.length]
}

export function buildEditContextItems(
  params: Pick<Electron.ContextMenuParams, 'isEditable' | 'editFlags' | 'selectionText'>,
  onSearch: (query: string) => void
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []

  if (params.isEditable) {
    items.push({ label: 'Desfazer', role: 'undo', enabled: params.editFlags.canUndo })
    items.push({ label: 'Refazer', role: 'redo', enabled: params.editFlags.canRedo })
    items.push({ type: 'separator' })
    items.push({ label: 'Cortar', role: 'cut', enabled: params.editFlags.canCut })
    items.push({ label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy })
    items.push({ label: 'Colar', role: 'paste', enabled: params.editFlags.canPaste })
    items.push({ label: 'Selecionar tudo', role: 'selectAll' })
    items.push({ type: 'separator' })
  } else if (params.selectionText) {
    const trimmed =
      params.selectionText.length > 40 ? `${params.selectionText.slice(0, 40)}…` : params.selectionText
    items.push({ label: 'Copiar', click: () => clipboard.writeText(params.selectionText) })
    items.push({ label: `Pesquisar por "${trimmed}"`, click: () => onSearch(params.selectionText) })
    items.push({ type: 'separator' })
  }

  return items
}

/** Reads the `width=`/`height=` pair out of a window.open() features string, e.g. "width=480,height=640". */
function parsePopupFeatures(features: string): { width?: number; height?: number } | null {
  if (!features) return null
  let width: number | undefined
  let height: number | undefined
  for (const part of features.split(',')) {
    const [key, value] = part.split('=').map((s) => s.trim())
    if (key === 'width') width = Number(value) || undefined
    if (key === 'height') height = Number(value) || undefined
  }
  return width || height ? { width, height } : null
}

/** Gives a real popup window (opened via window.open with size features) the same basics a tab
 * gets: F12 devtools, a right-click menu, and support for it opening further popups of its own. */
function wireChildWindow(win: BrowserWindow): void {
  const wc = win.webContents
  wc.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F12') return
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'detach' })
  })
  wc.on('context-menu', (_e, params) => {
    const items = buildEditContextItems(params, (query) => wc.loadURL(searchUrl(query)))
    items.push({ label: 'Recarregar', click: () => wc.reload() })
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
  wc.on('did-create-window', (grandChild) => wireChildWindow(grandChild))
}
