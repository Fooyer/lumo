import { randomUUID } from 'crypto'
import {
  providerInfo,
  type AiChatMessage,
  type AiEvent,
  type AiSendResult,
  type AiModelsResult,
  type AiTestResult,
  type AssistantSettings
} from '../../shared/ai'
import type { AiStore } from './aiStore'
import { buildSystemPrompt } from './persona'
import { callLlm, listModels, LlmError, type LlmMessage } from './providers'
import { remarkSystemPrompt } from './remarks'
import { claimsAction, parseOpenCommand } from './quickActions'
import { AiTools, settingsSummary, type ToolBridge } from './tools'
import type { Settings } from '../../shared/ipc'

const MAX_STEPS = 10
const CONFIRM_TIMEOUT_MS = 60_000
// How much of the saved conversation goes back to the model each turn.
const CONTEXT_MESSAGES = 24

interface PendingConfirm {
  resolve: (ok: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * The brain: takes what the user wrote, talks to the chosen model with the browser's tools in hand, runs the
 * tools it asks for (looping until it has an answer) and reports every step as events for the UI.
 */
export class AiAgent {
  private tools: AiTools
  private busy = false
  private abort: AbortController | null = null
  private pending = new Map<string, PendingConfirm>()
  private emit: (event: AiEvent) => void = () => {}

  constructor(
    private bridge: Omit<ToolBridge, 'confirm'>,
    private store: AiStore
  ) {
    this.tools = new AiTools({ ...bridge, confirm: (title, detail) => this.askConfirm(title, detail) })
  }

  setEmitter(cb: (event: AiEvent) => void): void {
    this.emit = cb
  }

  get isBusy(): boolean {
    return this.busy
  }

  private config(): AssistantSettings {
    return this.bridge.getSettings().assistant
  }

  private resolved(cfg: AssistantSettings): { model: string; baseUrl: string; apiKey: string | null } {
    const info = providerInfo(cfg.provider)
    return {
      model: cfg.model.trim() || info.defaultModel,
      baseUrl: cfg.baseUrl.trim() || info.baseUrl,
      apiKey: this.store.getKey(cfg.provider)
    }
  }

  replyConfirm(id: string, ok: boolean): void {
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.resolve(ok)
    this.emit({ type: 'confirm-done', id })
  }

  private askConfirm(title: string, detail: string): Promise<boolean> {
    const id = randomUUID()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.replyConfirm(id, false), CONFIRM_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      this.emit({ type: 'confirm', id, title, detail })
    })
  }

  cancel(): void {
    this.abort?.abort()
    for (const id of [...this.pending.keys()]) this.replyConfirm(id, false)
  }

  clearConversation(): void {
    this.cancel()
    this.store.clearHistory()
    this.emit({ type: 'cleared' })
  }

  /** A quick check that the saved key and model answer (used by the settings page). */
  async test(): Promise<AiTestResult> {
    const cfg = this.config()
    const info = providerInfo(cfg.provider)
    const r = this.resolved(cfg)
    if (info.needsKey && !r.apiKey) return { ok: false, message: 'Salve uma chave primeiro.' }
    if (!r.model) return { ok: false, message: 'Escolha um modelo.' }
    try {
      const out = await callLlm({
        provider: cfg.provider,
        model: r.model,
        apiKey: r.apiKey,
        baseUrl: r.baseUrl,
        system: 'Responda em português com no máximo cinco palavras.',
        messages: [{ role: 'user', text: 'Diga olá.' }],
        tools: [],
        signal: new AbortController().signal
      })
      return { ok: true, message: out.text ? `Funcionou! Resposta: “${out.text.slice(0, 80)}”` : 'Funcionou!' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  /** One unprompted remark about the page the user is on (title and site only). Null when there is nothing to say. */
  async remark(title: string, host: string, recent: string[]): Promise<string | null> {
    const cfg = this.config()
    const info = providerInfo(cfg.provider)
    const r = this.resolved(cfg)
    if ((info.needsKey && !r.apiKey) || !r.model) return null
    const signal = AbortSignal.timeout(25_000)
    try {
      const out = await callLlm({
        provider: cfg.provider,
        model: r.model,
        apiKey: r.apiKey,
        baseUrl: r.baseUrl,
        system: remarkSystemPrompt(cfg.persona, recent),
        messages: [{ role: 'user', text: `Página: "${title.slice(0, 140)}" (${host})` }],
        tools: [],
        signal
      })
      const text = out.text
        .replace(/\[[^\]]{1,20}\]/g, '')
        .replace(/^["“”'\s]+|["“”'\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text || /^nada\b/i.test(text) || text.length > 220) return null
      return text
    } catch {
      return null
    }
  }

  /** The models the saved key can use, straight from the service. */
  async models(): Promise<AiModelsResult> {
    const cfg = this.config()
    const info = providerInfo(cfg.provider)
    const r = this.resolved(cfg)
    if (info.needsKey && !r.apiKey) return { ok: false, models: [], message: 'Salve uma chave primeiro.' }
    try {
      const models = await listModels(cfg.provider, r.baseUrl, r.apiKey)
      return { ok: true, models, message: models.length ? '' : 'O serviço não listou nenhum modelo.' }
    } catch (err) {
      return { ok: false, models: [], message: (err as Error).message }
    }
  }

  async send(userText: string, viaVoice = false): Promise<AiSendResult> {
    const text = userText.trim()
    if (!text) return { ok: false, error: 'Mensagem vazia.', code: 'other' }
    if (this.busy) return { ok: false, error: 'A Lumi ainda está terminando o pedido anterior.', code: 'busy' }

    const cfg = this.config()
    const info = providerInfo(cfg.provider)
    const r = this.resolved(cfg)
    if (info.needsKey && !r.apiKey) {
      return { ok: false, error: `Falta a chave de ${info.label}. Configure em Configurações → Assistente.`, code: 'no-key' }
    }

    this.busy = true
    this.abort = new AbortController()
    const signal = this.abort.signal
    this.emit({ type: 'busy', busy: true })

    const history = this.store.history()
    const firstMeeting = history.length === 0 && this.store.notes().length === 0
    const userMessage: AiChatMessage = { id: randomUUID(), role: 'user', text, at: Date.now() }
    this.store.appendHistory(userMessage)
    if (viaVoice) this.emit({ type: 'user', message: userMessage })

    const messages: LlmMessage[] = [
      ...history.slice(-CONTEXT_MESSAGES).map((m): LlmMessage => (m.role === 'user' ? { role: 'user', text: m.text } : { role: 'assistant', text: m.text })),
      { role: 'user', text }
    ]

    try {
      let finalText = ''
      let usedTool = false
      let nudged = false

      // "abra o youtube": understood with plain rules, so it happens at once and for sure.
      const quick = info.noTools ? null : parseOpenCommand(text)
      if (quick) {
        const call = { id: randomUUID(), name: 'open_tab', args: { url: quick.url } as Record<string, unknown> }
        const meta = this.tools.meta(call.name, call.args)
        if (meta.label) this.emit({ type: 'tool-start', id: call.id, name: call.name, label: meta.label, anim: meta.anim })
        const out = await this.tools.run(call.name, call.args, cfg.autonomy)
        if (meta.label) this.emit({ type: 'tool-end', id: call.id, ok: out.ok, summary: out.ok ? 'ok' : out.content.slice(0, 120) })
        const girl = cfg.persona === 'girl'
        finalText = out.ok
          ? girl
            ? `[feliz] Pronto! Abri ${quick.name} numa aba nova pra você.`
            : `[neutra] Tá feito. ${quick.name} aberto numa aba nova.`
          : `[triste] Não consegui abrir ${quick.name}. ${out.content.slice(0, 160)}`
      }

      for (let step = 0; !finalText && step < MAX_STEPS; step++) {
        const system = buildSystemPrompt({
          now: new Date(),
          tabs: this.bridge.tabs.list().map((t) => ({
            id: t.id,
            title: t.title,
            url: t.url,
            active: t.id === this.bridge.tabs.getActiveId(),
            private: t.incognito
          })),
          settingsSummary:
            settingsSummary(this.bridge.getSettings() as Settings) +
            (info.noTools
              ? '\n- ATENÇÃO: neste momento você está num serviço SEM ferramentas. Você só consegue conversar: NÃO consegue abrir abas, ler ou mexer em páginas, nem mudar configurações. Se pedirem algo assim, explique com simpatia que precisa de uma chave de IA (Configurações → Assistente) e, enquanto isso, só pode conversar.'
              : ''),
          notes: this.store.notes(),
          firstMeeting
        }, cfg.persona)
        const response = await this.callWithRetry({
          provider: cfg.provider,
          model: r.model,
          apiKey: r.apiKey,
          baseUrl: r.baseUrl,
          system,
          messages,
          tools: info.noTools ? [] : this.tools.specs(),
          signal
        })

        if (!response.toolCalls.length) {
          // It says it did something but called no tool: make it actually do it (once) instead of believing it.
          if (!usedTool && !nudged && !info.noTools && claimsAction(response.text)) {
            nudged = true
            messages.push({ role: 'assistant', text: response.text, raw: response.raw })
            messages.push({
              role: 'user',
              text: '[AVISO DO SISTEMA] Você disse que fez algo, mas não chamou nenhuma ferramenta, então nada aconteceu de verdade. Chame agora a ferramenta certa (open_tab, navigate, read_page, click_element…) para fazer o que a pessoa pediu. Só diga que fez depois que a ferramenta confirmar. Se não for possível, diga a verdade.'
            })
            continue
          }
          finalText = response.text
          break
        }

        usedTool = true
        messages.push({ role: 'assistant', text: response.text, toolCalls: response.toolCalls, raw: response.raw })
        const results = []
        for (const call of response.toolCalls) {
          if (signal.aborted) throw new LlmError('Cancelado.', 'network')
          const meta = this.tools.meta(call.name, call.args)
          if (meta.label) this.emit({ type: 'tool-start', id: call.id, name: call.name, label: meta.label, anim: meta.anim })
          const out = await this.tools.run(call.name, call.args, cfg.autonomy)
          if (meta.label) this.emit({ type: 'tool-end', id: call.id, ok: out.ok, summary: out.ok ? 'ok' : out.content.slice(0, 120) })
          results.push({ id: call.id, name: call.name, content: out.content })
        }
        messages.push({ role: 'tool', results })
        if (step === MAX_STEPS - 1) finalText = '[surpresa] Fiz um monte de coisas seguidas e preciso parar um instante. Quer que eu continue?'
      }

      if (!finalText) finalText = '[pensando] Hmm, fiquei sem palavras. Pode repetir de outro jeito?'
      const reply: AiChatMessage = { id: randomUUID(), role: 'assistant', text: finalText, at: Date.now() }
      this.store.appendHistory(reply)
      this.emit({ type: 'message', message: reply })
      return { ok: true }
    } catch (err) {
      const e = err as Error
      if (signal.aborted) {
        this.emit({ type: 'error', message: 'Tudo bem, parei.', code: 'other' })
        return { ok: false, error: 'cancelled', code: 'other' }
      }
      const code = err instanceof LlmError ? (err.kind === 'auth' ? 'auth' : err.kind === 'quota' ? 'quota' : err.kind === 'network' ? 'network' : 'other') : 'other'
      this.emit({ type: 'error', message: e.message, code })
      return { ok: false, error: e.message, code }
    } finally {
      this.busy = false
      this.abort = null
      this.emit({ type: 'busy', busy: false })
    }
  }

  /** One retry for the transient failures (rate limit bursts, a hiccup on the server). */
  private async callWithRetry(req: Parameters<typeof callLlm>[0]): ReturnType<typeof callLlm> {
    try {
      return await callLlm(req)
    } catch (err) {
      // A retired Gemini model: move to the current one for good and try again.
      const fallback = providerInfo('gemini').defaultModel
      if (err instanceof LlmError && err.kind === 'model' && req.provider === 'gemini' && req.model !== fallback && !req.signal.aborted) {
        const cfg = this.config()
        this.bridge.applySettings({ assistant: { ...cfg, model: fallback } })
        return callLlm({ ...req, model: fallback })
      }
      if (err instanceof LlmError && (err.kind === 'server' || err.kind === 'quota') && !req.signal.aborted) {
        await new Promise((r) => setTimeout(r, 2500))
        return callLlm(req)
      }
      throw err
    }
  }
}
