import { PERSONAS, type AssistantSettings } from '../../shared/ai'
import type { Tab, TabManager } from '../tabManager'
import { isInternalUrl } from '../tabManager'
import type { AiAgent } from './agent'

const CHECK_EVERY_MS = 30_000
const FIRST_AFTER_MS = 3 * 60_000
const MIN_GAP_MS = 4 * 60_000
const MAX_GAP_MS = 9 * 60_000
/** The same site is not commented on again before this long. */
const SAME_SITE_MS = 25 * 60_000
const KEEP = 8

interface Deps {
  getAssistant: () => AssistantSettings
  tabs: TabManager
  agent: AiAgent
  windowActive: () => boolean
  chatOpen: () => boolean
  /** Shows (and, with the voice on, speaks) what she says. */
  say: (text: string) => void
}

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo)

/**
 * Now and then, when the user has been on a page for a while, she says something about it, like a person sitting
 * next to them would: a curiosity, an opinion, a small joke. Only the page's title and site name go to the AI
 * service, never the content, and private tabs are never looked at.
 */
export class Remarker {
  private timer: ReturnType<typeof setInterval> | null = null
  private startedAt = Date.now()
  private lastAt = 0
  private gap = rand(MIN_GAP_MS, MAX_GAP_MS)
  private asking = false
  private seen = new Map<string, number>()
  private said: string[] = []
  /** What the active tab looked like at the last check: she waits until the user has settled on a page. */
  private lastKey = ''
  private sameSince = 0

  constructor(private d: Deps) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private candidate(): { tab: Tab; host: string } | null {
    const active = this.d.tabs.list().find((t) => t.id === this.d.tabs.getActiveId())
    if (!active || active.incognito || active.loading || isInternalUrl(active.url) || !active.title.trim()) return null
    let host: string
    try {
      const u = new URL(active.url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      host = u.hostname.replace(/^www\./, '')
    } catch {
      return null
    }
    return { tab: active, host }
  }

  private async tick(): Promise<void> {
    const cfg = this.d.getAssistant()
    if (!cfg.enabled || !cfg.curiosity || this.asking) return
    const now = Date.now()
    if (now - this.startedAt < FIRST_AFTER_MS || now - this.lastAt < this.gap) return
    if (!this.d.windowActive() || this.d.chatOpen() || this.d.agent.isBusy) return
    const c = this.candidate()
    if (!c) return

    // she waits until the user has stayed on this page for a bit
    const key = `${c.tab.id}|${c.tab.url}`
    if (key !== this.lastKey) {
      this.lastKey = key
      this.sameSince = now
      return
    }
    if (now - this.sameSince < 25_000) return
    if (now - (this.seen.get(c.host) ?? 0) < SAME_SITE_MS) return

    this.asking = true
    try {
      const text = await this.d.agent.remark(c.tab.title, c.host, this.said)
      if (!text) return
      this.seen.set(c.host, now)
      this.said.push(text)
      if (this.said.length > KEEP) this.said.shift()
      this.lastAt = Date.now()
      this.gap = rand(MIN_GAP_MS, MAX_GAP_MS)
      // the user may have left the page, or opened the chat, while she was thinking
      if (this.d.chatOpen() || this.candidate()?.host !== c.host) return
      this.d.say(text)
    } finally {
      this.asking = false
    }
  }
}

export function remarkSystemPrompt(persona: AssistantSettings['persona'], recent: string[]): string {
  const p = PERSONAS[persona]
  const voice =
    persona === 'girl'
      ? 'Você é a Lumi: animada, curiosa, carinhosa e um pouco dramática com coisas pequenas. Fala como amiga.'
      : 'Você é o Lux: calmo, observador, esperto, com humor seco e discreto. Fala pouco e certeiro.'
  return `${voice}
Você é a assistente de IA que mora num canto do navegador Lumo e vê a página que a pessoa está olhando (só o título e o nome do site).
De vez em quando você comenta algo, como uma pessoa sentada ao lado faria: uma curiosidade sobre o assunto, uma opinião sincera, uma observação ou uma brincadeira leve.

REGRAS:
- Responda com UMA frase curta (no máximo 150 caracteres), em português do Brasil, no seu jeito de falar (${p.name}).
- Nada de saudação, nada de "posso ajudar?", nada de pergunta sobre o que a pessoa quer. Pode ser uma pergunta curiosa e curta, mas só de vez em quando.
- Não invente fatos sobre a página que você não sabe. Se só tiver o título, comente o assunto ou a vibe, sem afirmar o que há dentro.
- Sem emojis (no máximo um), sem aspas, sem markdown, sem etiquetas entre colchetes.
- Se o site for sério ou sensível (saúde, dinheiro, trabalho, luto, banco, e-mail), responda apenas: NADA.
${recent.length ? `- Você já disse isto recentemente; não repita nem soe parecida:\n${recent.map((r) => `  • ${r}`).join('\n')}` : ''}`
}
