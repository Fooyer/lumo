import type { Suggestion } from '@shared/ipc'

// Search-result pages are history, but nobody wants the address bar to complete "duck" into one.
const SEARCH_HOSTS = /(^|\.)(duckduckgo|google|bing|yahoo|ecosia|brave)\./i

function isSearchResult(url: string): boolean {
  try {
    const u = new URL(url)
    return SEARCH_HOSTS.test(u.hostname) && u.searchParams.has('q')
  } catch {
    return false
  }
}

/**
 * The text the address bar should fill in for what the user typed, like other browsers do: the top
 * suggestion, when it starts with the typed text. The user's own characters are kept as typed and
 * only the rest is appended. Returns null when the top suggestion doesn't extend the text.
 */
export function inlineCompletion(typed: string, suggestions: Suggestion[]): string | null {
  const top = suggestions[0]
  if (!typed || typed !== typed.trim() || !top || isSearchResult(top.url)) return null

  const noScheme = top.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const noWww = noScheme.replace(/^www\./i, '')
  const schemeOnly = top.url.slice(0, top.url.length - noScheme.length)
  // What the user might be typing towards: the bare address, without "www.", or with the scheme.
  const forms = [noScheme, noWww, top.url, schemeOnly + noWww]

  const lower = typed.toLowerCase()
  for (const form of forms) {
    if (form.length <= typed.length || !form.toLowerCase().startsWith(lower)) continue
    let text = typed + form.slice(typed.length)
    // "site.com/" is just "site.com".
    if (/^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/]+\/$/i.test(text)) text = text.slice(0, -1)
    return text.length > typed.length ? text : null
  }
  return null
}
