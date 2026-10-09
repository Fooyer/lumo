/**
 * What the assistant can do to the part of a page she doesn't want the user to reach: cover it with a shield.
 * A shield swallows pointer input and (for an element) makes the element inert, so keyboard and focus can't get
 * in either. Shields follow their element while the page scrolls or reflows, come back after a reload of the
 * same page, and go away when the tab leaves the page or she lifts them.
 *
 * The scripts are plain strings on purpose: they run in the page, so the bundler must not touch them.
 */

export interface ShieldSpec {
  /** The element's data-lumo-id from the last read_page (when covering an element). */
  id?: number
  /** Fractions (0-1) of the visible area, for covering a region that is not a single element. */
  region?: { x: number; y: number; w: number; h: number }
  label: string
}

interface StoredShield {
  key: string
  selector?: string
  /** Document pixels, for a region. */
  rect?: { x: number; y: number; w: number; h: number }
  label: string
}

const RUNTIME = String.raw`(() => {
  if (window.__lumoShield) return
  const shields = new Map()
  let raf = 0
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation() }
  const place = (s) => {
    let r
    if (s.el) { if (!s.el.isConnected) { s.box.style.display = 'none'; return } r = s.el.getBoundingClientRect() }
    else r = { left: s.rect.x - scrollX, top: s.rect.y - scrollY, width: s.rect.w, height: s.rect.h }
    const hidden = r.width < 2 || r.height < 2
    s.box.style.display = hidden ? 'none' : 'flex'
    s.box.style.left = r.left + 'px'
    s.box.style.top = r.top + 'px'
    s.box.style.width = r.width + 'px'
    s.box.style.height = r.height + 'px'
  }
  const tick = () => { raf = 0; shields.forEach(place) }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(tick) }
  addEventListener('scroll', schedule, true)
  addEventListener('resize', schedule)
  setInterval(schedule, 400)
  window.__lumoShield = {
    add(key, selector, rect, label) {
      this.remove(key)
      const el = selector ? document.querySelector(selector) : null
      if (selector && !el) return false
      const box = document.createElement('div')
      box.setAttribute('data-lumo-shield', key)
      box.title = 'Bloqueado pela assistente. Peça a ela para liberar.'
      box.style.cssText = 'position:fixed;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;box-sizing:border-box;overflow:hidden;padding:8px;text-align:center;cursor:not-allowed;pointer-events:auto;border:2px solid #ff6b9d;border-radius:10px;color:#fff;font:700 13px/1.25 system-ui,sans-serif;text-shadow:0 1px 2px rgba(0,0,0,.6);background:repeating-linear-gradient(45deg,rgba(20,21,29,.9) 0 12px,rgba(58,36,88,.9) 12px 24px);backdrop-filter:blur(4px);box-shadow:0 0 0 4px rgba(255,107,157,.25),0 8px 30px rgba(0,0,0,.4);animation:lumoShieldIn .25s ease-out'
      const title = document.createElement('div')
      title.textContent = '🛡️ Bloqueado'
      box.appendChild(title)
      if (label) { const sub = document.createElement('div'); sub.style.cssText = 'font-weight:500;font-size:12px;opacity:.9'; sub.textContent = label; box.appendChild(sub) }
      for (const ev of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'wheel', 'touchstart']) {
        if (ev !== 'wheel') box.addEventListener(ev, stop, true)
      }
      if (!document.getElementById('lumo-shield-style')) {
        const st = document.createElement('style')
        st.id = 'lumo-shield-style'
        st.textContent = '@keyframes lumoShieldIn{from{opacity:0;transform:scale(1.08)}to{opacity:1;transform:none}}'
        document.documentElement.appendChild(st)
      }
      document.documentElement.appendChild(box)
      if (el) el.inert = true
      const s = { box, el, rect }
      shields.set(key, s)
      place(s)
      return true
    },
    remove(key) {
      const drop = (k, s) => { if (s.el) s.el.inert = false; s.box.remove(); shields.delete(k) }
      if (key) { const s = shields.get(key); if (s) drop(key, s) }
      else Array.from(shields.entries()).forEach(([k, s]) => drop(k, s))
    },
    count() { return shields.size }
  }
})()`

/** A CSS selector that finds this element again after a reload. */
const FIND_SELECTOR = (id: number): string => String.raw`(() => {
  const el = document.querySelector('[data-lumo-id="${id}"]')
  if (!el) return null
  const parts = []
  let node = el
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) { parts.unshift('#' + CSS.escape(node.id)); break }
    const tag = node.tagName.toLowerCase()
    const same = Array.from(node.parentElement ? node.parentElement.children : []).filter((c) => c.tagName === node.tagName)
    parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(node) + 1) + ')' : tag)
    node = node.parentElement
  }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  return parts.join(' > ')
})()`

const VIEWPORT = String.raw`(() => ({ w: innerWidth, h: innerHeight, sx: scrollX, sy: scrollY }))()`

const ADD = (key: string, selector: string | null, rect: StoredShield['rect'] | null, label: string): string =>
  String.raw`(() => window.__lumoShield.add(${JSON.stringify(key)}, ${JSON.stringify(selector)}, ${JSON.stringify(rect)}, ${JSON.stringify(label)}))()`

const REMOVE = (key: string | null): string => String.raw`(() => { if (window.__lumoShield) window.__lumoShield.remove(${JSON.stringify(key)}); return true })()`

/** The shields of each tab, so they can be put back when the same page loads again. */
const stored = new Map<number, { page: string; list: StoredShield[] }>()
const watched = new Set<number>()

function pageKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return url
  }
}

async function apply(wc: Electron.WebContents, s: StoredShield): Promise<boolean> {
  await wc.executeJavaScript(RUNTIME, true)
  return (await wc.executeJavaScript(ADD(s.key, s.selector ?? null, s.rect ?? null, s.label), true)) === true
}

function watch(wc: Electron.WebContents): void {
  if (watched.has(wc.id)) return
  watched.add(wc.id)
  const reapply = (): void => {
    const entry = stored.get(wc.id)
    if (!entry || wc.isDestroyed()) return
    if (pageKey(wc.getURL()) !== entry.page) {
      stored.delete(wc.id) // the tab moved on: nothing to protect any more
      return
    }
    for (const s of entry.list) void apply(wc, s).catch(() => {})
  }
  wc.on('did-finish-load', reapply)
  wc.once('destroyed', () => {
    stored.delete(wc.id)
    watched.delete(wc.id)
  })
}

/** Covers an element or a region of the page. Resolves with where it is (page pixels) for the mascot to fly to. */
export async function addShield(wc: Electron.WebContents, spec: ShieldSpec): Promise<{ ok: boolean; error?: string; count: number }> {
  const key = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
  const shield: StoredShield = { key, label: spec.label.slice(0, 80) }
  if (spec.id !== undefined) {
    const selector = (await wc.executeJavaScript(FIND_SELECTOR(spec.id), true)) as string | null
    if (!selector) return { ok: false, error: 'Esse elemento não existe mais. Chame read_page de novo.', count: 0 }
    shield.selector = selector
  } else if (spec.region) {
    const v = (await wc.executeJavaScript(VIEWPORT, true)) as { w: number; h: number; sx: number; sy: number }
    const c = (n: number): number => Math.max(0, Math.min(1, n))
    const r = spec.region
    shield.rect = { x: v.sx + c(r.x) * v.w, y: v.sy + c(r.y) * v.h, w: Math.max(0.04, c(r.w)) * v.w, h: Math.max(0.04, c(r.h)) * v.h }
  } else {
    return { ok: false, error: 'Diga qual elemento (element_id) ou região cobrir.', count: 0 }
  }
  if (!(await apply(wc, shield))) return { ok: false, error: 'Não consegui cobrir isso na página.', count: 0 }
  const entry = stored.get(wc.id) ?? { page: pageKey(wc.getURL()), list: [] }
  entry.list.push(shield)
  stored.set(wc.id, entry)
  watch(wc)
  return { ok: true, count: entry.list.length }
}

/** Lifts every shield of the tab. */
export async function removeShields(wc: Electron.WebContents): Promise<number> {
  const n = stored.get(wc.id)?.list.length ?? 0
  stored.delete(wc.id)
  await wc.executeJavaScript(REMOVE(null), true).catch(() => {})
  return n
}

export function shieldCount(wc: Electron.WebContents): number {
  return stored.get(wc.id)?.list.length ?? 0
}
