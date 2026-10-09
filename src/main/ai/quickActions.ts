/**
 * Requests that need no thinking: "abra o youtube", "abre github.com numa nova aba". Understood with plain rules
 * so the answer is immediate and never depends on the model remembering to call a tool (it used to say
 * "pronto, abri!" without opening anything).
 */

const SITES: Record<string, { url: string; name: string }> = {
  youtube: { url: 'https://www.youtube.com', name: 'YouTube' },
  google: { url: 'https://www.google.com', name: 'Google' },
  gmail: { url: 'https://mail.google.com', name: 'Gmail' },
  drive: { url: 'https://drive.google.com', name: 'Google Drive' },
  'google drive': { url: 'https://drive.google.com', name: 'Google Drive' },
  maps: { url: 'https://maps.google.com', name: 'Google Maps' },
  'google maps': { url: 'https://maps.google.com', name: 'Google Maps' },
  github: { url: 'https://github.com', name: 'GitHub' },
  whatsapp: { url: 'https://web.whatsapp.com', name: 'WhatsApp Web' },
  'whatsapp web': { url: 'https://web.whatsapp.com', name: 'WhatsApp Web' },
  instagram: { url: 'https://www.instagram.com', name: 'Instagram' },
  facebook: { url: 'https://www.facebook.com', name: 'Facebook' },
  twitter: { url: 'https://x.com', name: 'o X (Twitter)' },
  x: { url: 'https://x.com', name: 'o X' },
  tiktok: { url: 'https://www.tiktok.com', name: 'TikTok' },
  netflix: { url: 'https://www.netflix.com', name: 'Netflix' },
  spotify: { url: 'https://open.spotify.com', name: 'Spotify' },
  twitch: { url: 'https://www.twitch.tv', name: 'Twitch' },
  discord: { url: 'https://discord.com/app', name: 'Discord' },
  reddit: { url: 'https://www.reddit.com', name: 'Reddit' },
  linkedin: { url: 'https://www.linkedin.com', name: 'LinkedIn' },
  pinterest: { url: 'https://www.pinterest.com', name: 'Pinterest' },
  wikipedia: { url: 'https://pt.wikipedia.org', name: 'Wikipédia' },
  amazon: { url: 'https://www.amazon.com.br', name: 'Amazon' },
  'mercado livre': { url: 'https://www.mercadolivre.com.br', name: 'Mercado Livre' },
  mercadolivre: { url: 'https://www.mercadolivre.com.br', name: 'Mercado Livre' },
  chatgpt: { url: 'https://chatgpt.com', name: 'ChatGPT' },
  claude: { url: 'https://claude.ai', name: 'Claude' },
  outlook: { url: 'https://outlook.live.com', name: 'Outlook' },
  hotmail: { url: 'https://outlook.live.com', name: 'Outlook' },
  g1: { url: 'https://g1.globo.com', name: 'G1' },
  globo: { url: 'https://www.globo.com', name: 'Globo' },
  uol: { url: 'https://www.uol.com.br', name: 'UOL' },
  'prime video': { url: 'https://www.primevideo.com', name: 'Prime Video' },
  'disney plus': { url: 'https://www.disneyplus.com', name: 'Disney+' },
  'disney+': { url: 'https://www.disneyplus.com', name: 'Disney+' }
}

const DOMAIN = /^(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/\S*)?$/i

const OPEN =
  /^(?:(?:por favor|pf|pfv)[,\s]+)?(?:(?:pode|consegue|poderia|queria que (?:voce|vc)|quero que (?:voce|vc))\s+)?(?:(?:me|nos)\s+)?(?:abr(?:a|e|ir|indo)|acess(?:a|e|ar)|va para|vai (?:para|pra|pro)|entra(?:r)? (?:no|na|em)|carrega(?:r)?|abre ai)\s+(?:o |a |um |uma |no |na )?(?:site |pagina |aplicativo |app )?(?:do |da |de )?(.+?)(?:\s+(?:em|numa?|na|no)\s+(?:uma?\s+)?(?:nova\s+)?(?:aba|guia)(?:\s+nova)?)?(?:\s+(?:para|pra) mim|\s+por favor|\s+pf|\s+ai)?[.!?\s]*$/

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The address a plain "open X" request points at, or null when it needs the model to make sense of it. */
export function parseOpenCommand(text: string): { url: string; name: string } | null {
  const t = plain(text)
  if (t.length > 90) return null
  const m = OPEN.exec(t)
  if (!m) return null
  const target = m[1].replace(/^["'`]+|["'`]+$/g, '').trim()
  if (!target) return null
  const known = SITES[target] ?? SITES[target.replace(/\s+/g, '')]
  if (known) return known
  const d = DOMAIN.exec(target)
  if (d) {
    const host = d[1]
    return { url: `https://${host}${d[2] ?? ''}`, name: host }
  }
  return null
}

/** A reply that announces the next step ("deixa eu olhar…", "vou abrir…") and stops there, without asking anything. */
export function promisesMore(text: string): boolean {
  const t = plain(text)
  // a closing question hands the turn to the person: that is a clear stop, not a dropped promise
  if (/\?[~!.…\s]*$/.test(t)) return false
  return /\b(deixa eu|deixe me|vou (?:dar|olhar|ver|abrir|procurar|pesquisar|ler|clicar|entrar|checar|verificar|tentar|buscar|fazer|conferir|navegar|acessar|escolher|preencher|escrever|mudar|trocar)|ja volto|ja vejo|ja olho|ja abro|ja confiro|um instante|um segundinho|um momentinho|so um (?:instante|minuto|segundo|momento)|me da um (?:instante|segundo|minuto)|aguarda|aguenta ai)\b/.test(t)
}

/** A search engine's results page: where a search lands, which is not the site the person asked for. */
export function isSearchPage(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'duckduckgo.com' || host === 'search.brave.com' || host === 'ecosia.org' || host === 'startpage.com') return u.searchParams.has('q') || u.pathname.startsWith('/search')
    if (/^(google|bing|yahoo)\./.test(host) || host.endsWith('.google.com')) return u.pathname.startsWith('/search') || u.searchParams.has('q')
    return false
  } catch {
    return false
  }
}

/** Whether a reply claims that something was done (used to catch claims with no action behind them). */
export function claimsAction(text: string): boolean {
  return /\b(abri|abrindo|ja abri|ja fiz|fiz isso|feito|pronto|prontinho|ta feito|tá feito|fechei|troquei|mudei|apontei|organizei|bloqueei|liberei|salvei|adicionei|removi|pesquisei|cliquei|escrevi|preenchi)\b/i.test(
    plain(text)
  )
}
