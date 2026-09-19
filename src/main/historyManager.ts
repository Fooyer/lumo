import fs from 'fs'
import { randomUUID } from 'crypto'
import type { Bookmark, HistoryPage, HistoryVisit, HistoryListResult, Suggestion } from '../shared/ipc'

const MAX_VISITS = 30000
const MAX_PAGES = 10000
const SAVE_DEBOUNCE_MS = 2000
const CHANGE_DEBOUNCE_MS = 400
// A reload or a redirect chain reports the same URL twice in quick succession — that's one visit.
const DUPLICATE_WINDOW_MS = 3000
const DAY_MS = 24 * 60 * 60 * 1000
const RECENCY_HALF_LIFE_DAYS = 14

interface Stored {
  pages: HistoryPage[]
  visits: HistoryVisit[]
}

/** Only real web pages are worth remembering (not lumo:// pages, error pages, data: URLs, …). */
function isRecordable(url: string): boolean {
  return /^https?:\/\//i.test(url) && url.length <= 2048
}

/** The identity of a page: its URL without the #fragment, so in-page anchors don't fragment the history. */
function pageKey(url: string): string {
  const i = url.indexOf('#')
  return i === -1 ? url : url.slice(0, i)
}

/** What the user would recognise and type: no scheme, no leading "www.". */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
}

function hostOf(display: string): string {
  const end = display.search(/[/?#:]/)
  return end === -1 ? display : display.slice(0, end)
}

export class HistoryManager {
  private pages = new Map<string, HistoryPage>()
  private visits: HistoryVisit[] = []
  private saveTimer: NodeJS.Timeout | null = null
  private changeTimer: NodeJS.Timeout | null = null
  private dirty = false
  private onChange: () => void = () => {}

  constructor(private filePath: string) {
    this.load()
  }

  setOnChange(cb: () => void): void {
    this.onChange = cb
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<Stored>
      for (const p of Array.isArray(raw.pages) ? raw.pages : []) {
        if (typeof p?.url !== 'string' || !isRecordable(p.url)) continue
        this.pages.set(p.url, {
          url: p.url,
          title: typeof p.title === 'string' ? p.title : '',
          favicon: typeof p.favicon === 'string' ? p.favicon : null,
          visitCount: Number.isFinite(p.visitCount) ? p.visitCount : 1,
          lastVisitAt: Number.isFinite(p.lastVisitAt) ? p.lastVisitAt : 0
        })
      }
      for (const v of Array.isArray(raw.visits) ? raw.visits : []) {
        if (typeof v?.id !== 'string' || typeof v.url !== 'string' || !Number.isFinite(v.visitedAt)) continue
        if (this.pages.has(v.url)) this.visits.push({ id: v.id, url: v.url, visitedAt: v.visitedAt })
      }
    } catch {
      // primeiro uso ou arquivo ilegível: começa com o histórico vazio
    }
  }

  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, SAVE_DEBOUNCE_MS)
  }

  private notifyChanged(): void {
    if (this.changeTimer) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      this.onChange()
    }, CHANGE_DEBOUNCE_MS)
  }

  /** Writes pending changes to disk right now (also called on quit). Written to a temp file first so a crash never leaves a half-written history. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.dirty) return
    this.dirty = false
    const data: Stored = { pages: [...this.pages.values()], visits: this.visits }
    const tmp = `${this.filePath}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(data))
      fs.renameSync(tmp, this.filePath)
    } catch {
      // disco indisponível: o histórico continua valendo nesta sessão
      this.dirty = true
    }
  }

  recordVisit(rawUrl: string): void {
    if (!isRecordable(rawUrl)) return
    const url = pageKey(rawUrl)
    const now = Date.now()

    const last = this.visits[this.visits.length - 1]
    if (last && last.url === url && now - last.visitedAt < DUPLICATE_WINDOW_MS) return

    const page = this.pages.get(url)
    if (page) {
      page.visitCount++
      page.lastVisitAt = now
    } else {
      this.pages.set(url, { url, title: '', favicon: null, visitCount: 1, lastVisitAt: now })
    }
    this.visits.push({ id: randomUUID(), url, visitedAt: now })

    if (this.visits.length > MAX_VISITS) this.visits.splice(0, this.visits.length - MAX_VISITS)
    if (this.pages.size > MAX_PAGES) this.evictPages()
    this.scheduleSave()
    this.notifyChanged()
  }

  /** Title and icon arrive after the navigation commits, so they're filled in on the page already recorded. */
  updatePage(rawUrl: string, meta: { title?: string; favicon?: string | null }): void {
    const page = this.pages.get(pageKey(rawUrl))
    if (!page) return
    let changed = false
    if (meta.title && meta.title !== page.title) {
      page.title = meta.title
      changed = true
    }
    if (meta.favicon && meta.favicon !== page.favicon) {
      page.favicon = meta.favicon
      changed = true
    }
    if (!changed) return
    this.scheduleSave()
    this.notifyChanged()
  }

  /** Drops the least valuable pages (rarely visited, long ago) once the cap is exceeded. */
  private evictPages(): void {
    const now = Date.now()
    const ranked = [...this.pages.values()].sort((a, b) => frecency(a, now) - frecency(b, now))
    const drop = new Set(ranked.slice(0, this.pages.size - MAX_PAGES).map((p) => p.url))
    for (const url of drop) this.pages.delete(url)
    this.visits = this.visits.filter((v) => !drop.has(v.url))
  }

  /** Newest visits first, optionally narrowed to those whose page matches every word of `query`. */
  list(query: string, limit: number): HistoryListResult {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const items: HistoryListResult['items'] = []
    let total = 0
    for (let i = this.visits.length - 1; i >= 0; i--) {
      const visit = this.visits[i]
      const page = this.pages.get(visit.url)
      if (!page) continue
      if (tokens.length) {
        const hay = `${page.title} ${page.url}`.toLowerCase()
        if (!tokens.every((t) => hay.includes(t))) continue
      }
      total++
      if (items.length < limit) {
        items.push({ id: visit.id, url: page.url, title: page.title, favicon: page.favicon, visitedAt: visit.visitedAt })
      }
    }
    return { items, total }
  }

  removeVisit(id: string): void {
    const idx = this.visits.findIndex((v) => v.id === id)
    if (idx === -1) return
    const [visit] = this.visits.splice(idx, 1)
    const page = this.pages.get(visit.url)
    if (page) {
      page.visitCount--
      if (page.visitCount <= 0 || !this.visits.some((v) => v.url === visit.url)) this.pages.delete(visit.url)
    }
    this.scheduleSave()
    this.notifyChanged()
  }

  clear(): void {
    this.pages.clear()
    this.visits = []
    this.scheduleSave()
    this.notifyChanged()
  }

  /**
   * Pages to suggest while typing: those matching every word typed, ranked by how well they match,
   * how often they're visited and how recently. Bookmarks are candidates too, even if never visited.
   */
  suggest(query: string, bookmarks: Bookmark[], limit: number): Suggestion[] {
    const q = displayUrl(query.trim().toLowerCase())
    if (!q) return []
    const tokens = q.split(/\s+/).filter(Boolean)
    const now = Date.now()
    const bookmarked = new Set(bookmarks.map((b) => pageKey(b.url)))

    const scored: { score: number; suggestion: Suggestion }[] = []
    const consider = (url: string, title: string, favicon: string | null, page: HistoryPage | null): void => {
      const display = displayUrl(url).toLowerCase()
      const hay = `${title.toLowerCase()} ${display}`
      if (!tokens.every((t) => hay.includes(t))) return

      const host = hostOf(display)
      let score: number
      if (host.startsWith(q)) score = 3
      else if (display.startsWith(q)) score = 2.5
      else if (host.includes(tokens[0])) score = 1.5
      else if (title.toLowerCase().startsWith(q)) score = 1
      else score = 0.5
      if (display === host || display === `${host}/`) score += 0.4
      if (bookmarked.has(url)) score += 0.8
      if (page) score += frecency(page, now)

      scored.push({
        score,
        suggestion: {
          url,
          title,
          favicon,
          source: page ? 'history' : 'bookmark',
          visitCount: page?.visitCount ?? 0
        }
      })
    }

    for (const page of this.pages.values()) consider(page.url, page.title, page.favicon, page)
    for (const b of bookmarks) {
      const key = pageKey(b.url)
      if (isRecordable(key) && !this.pages.has(key)) consider(b.url, b.title, b.favicon, null)
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.suggestion)
  }
}

/** Frequency (diminishing returns) plus recency (halves every two weeks): what "most accessed" and "latest" blend into. */
function frecency(page: HistoryPage, now: number): number {
  const ageDays = Math.max(0, now - page.lastVisitAt) / DAY_MS
  const recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS)
  return Math.log2(1 + page.visitCount) * 0.6 + recency * 1.5
}
