import type { Bookmark } from '../../shared/ipc'

/**
 * "Abra X": where X is looked for, in this order. The favorites first, then the history, and only then the web.
 * Several things can carry the same name (two favorites called "Receitas", a site visited under different pages),
 * so a lookup either finds one clear answer or hands back the options for the person to choose from.
 */

export interface Candidate {
  title: string
  url: string
  source: 'favoritos' | 'histórico'
  favicon?: string | null
}

export type Lookup =
  | { kind: 'one'; candidate: Candidate }
  | { kind: 'several'; source: Candidate['source']; candidates: Candidate[] }
  | { kind: 'none' }

interface HistoryItem {
  url: string
  title: string
  visitedAt: number
  favicon?: string | null
}

export interface Sources {
  bookmarks: Bookmark[]
  history: (query: string, limit: number) => { items: HistoryItem[] }
}

export function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** The same page, however it was saved: no scheme, no www, no #fragment, no trailing slash. */
function sameKey(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** 3 = it is exactly that name, 2 = it starts with it, 1 = it contains every word, 0 = unrelated. */
function score(target: string, title: string, url: string): number {
  const t = norm(target)
  if (!t) return 0
  const compact = t.replace(/\s+/g, '')
  const ti = norm(title)
  const host = hostOf(url)
  const label = host.split('.')[0] ?? ''
  if (ti === t || label === compact || host === compact) return 3
  if (ti.startsWith(`${t} `) || ti.startsWith(t) || (compact.length >= 3 && host.startsWith(compact))) return 2
  const words = t.split(' ')
  return words.every((w) => ti.includes(w) || host.includes(w)) ? 1 : 0
}

function fromBookmarks(target: string, bookmarks: Bookmark[]): Lookup {
  const found = new Map<string, { c: Candidate; s: number }>()
  for (const b of bookmarks) {
    if (b.kind === 'folder' || !b.url) continue
    const s = score(target, b.title, b.url)
    if (!s) continue
    const key = sameKey(b.url)
    if (!found.has(key) || found.get(key)!.s < s) found.set(key, { c: { title: b.title || hostOf(b.url), url: b.url, source: 'favoritos', favicon: b.favicon ?? null }, s })
  }
  if (!found.size) return { kind: 'none' }
  const best = Math.max(...[...found.values()].map((f) => f.s))
  const top = [...found.values()].filter((f) => f.s === best).map((f) => f.c)
  return top.length === 1 ? { kind: 'one', candidate: top[0] } : { kind: 'several', source: 'favoritos', candidates: top.slice(0, 5) }
}

function fromHistory(target: string, history: Sources['history']): Lookup {
  // per page: how often and how lately; then one page per site (the one visited most)
  const pages = new Map<string, { title: string; url: string; count: number; last: number; favicon: string | null }>()
  for (const v of history(target, 400).items) {
    const key = sameKey(v.url)
    const p = pages.get(key) ?? { title: v.title, url: v.url, count: 0, last: 0, favicon: v.favicon ?? null }
    p.count++
    p.last = Math.max(p.last, v.visitedAt)
    if (v.title && !p.title) p.title = v.title
    pages.set(key, p)
  }
  type Page = { title: string; url: string; count: number; last: number; favicon: string | null }
  const sites = new Map<string, { page: Page; s: number; total: number }>()
  for (const p of pages.values()) {
    const s = score(target, p.title, p.url)
    if (!s) continue
    const host = hostOf(p.url)
    const site = sites.get(host)
    if (!site) sites.set(host, { page: p, s, total: p.count })
    else {
      site.total += p.count
      site.s = Math.max(site.s, s)
      if (p.count > site.page.count || (p.count === site.page.count && p.last > site.page.last)) site.page = p
    }
  }
  if (!sites.size) return { kind: 'none' }
  const ranked = [...sites.values()].sort((a, b) => b.s - a.s || b.total - a.total || b.page.last - a.page.last)
  const [first, second] = ranked
  const clear = !second || first.s > second.s || first.total >= second.total * 2
  const toCandidate = (x: (typeof ranked)[number]): Candidate => ({ title: x.page.title || hostOf(x.page.url), url: x.page.url, source: 'histórico', favicon: x.page.favicon })
  if (clear) {
    // within the winning site, go to its front door when that is what was asked ("youtube"), else to the page itself
    const host = hostOf(first.page.url)
    const home = norm(target).replace(/\s+/g, '') === host.split('.')[0]
    return { kind: 'one', candidate: { ...toCandidate(first), url: home ? `https://${host}` : first.page.url } }
  }
  return { kind: 'several', source: 'histórico', candidates: ranked.filter((x) => x.s === first.s).slice(0, 4).map(toCandidate) }
}

/** Favorites first; the history only when the favorites have nothing. */
export function lookup(target: string, src: Sources): Lookup {
  const fav = fromBookmarks(target, src.bookmarks)
  if (fav.kind !== 'none') return fav
  return fromHistory(target, src.history)
}

/** What the mascot holds out in her hands for each option. */
export function toOffer(candidates: Candidate[]): { title: string; host: string; favicon: string | null }[] {
  return candidates.map((c) => ({ title: c.title, host: hostOf(c.url), favicon: c.favicon ?? null }))
}

/** "Achei mais de um…": the options, numbered, as a question. */
export function describeChoices(target: string, l: Extract<Lookup, { kind: 'several' }>): string {
  const lines = l.candidates.map((c, i) => `${i + 1}) ${c.title} (${hostOf(c.url) || c.url})`)
  return `Achei mais de um "${target}" ${l.source === 'favoritos' ? 'nos seus favoritos' : 'no seu histórico'}:\n${lines.join('\n')}\nQual você quer? Pode dizer o número.`
}

const ORDINALS: Record<string, number> = {
  primeiro: 1, primeira: 1, um: 1, segundo: 2, segunda: 2, dois: 2, terceiro: 3, terceira: 3, tres: 3, quarto: 4, quarta: 4, quatro: 4, quinto: 5, quinta: 5, cinco: 5
}

/** Which of the offered options a reply picks ("2", "o segundo", "o do github"), or null. */
export function pickChoice(reply: string, options: Candidate[]): Candidate | null {
  const t = norm(reply)
  if (!t) return null
  const digit = /(?:^|\s)([1-9])(?:\s|$|\.|\))/.exec(t)
  if (digit && options[Number(digit[1]) - 1]) return options[Number(digit[1]) - 1]
  for (const word of t.split(' ')) {
    const n = ORDINALS[word]
    if (n && options[n - 1]) return options[n - 1]
  }
  const hits = options.filter((o) => {
    const ti = norm(o.title)
    const host = hostOf(o.url)
    return t.split(' ').some((w) => w.length >= 3 && (ti.includes(w) || host.includes(w)))
  })
  return hits.length === 1 ? hits[0] : null
}

/** A reply that drops the question ("nenhum", "deixa", "cancela"). */
export function isDismissal(reply: string): boolean {
  return /\b(nenhum|nenhuma|deixa|deixe|cancela|cancelar|esquece|nao quero|para)\b/.test(norm(reply))
}
