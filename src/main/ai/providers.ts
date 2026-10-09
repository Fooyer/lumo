import { randomUUID } from 'crypto'
import { net } from 'electron'
import type { AiProviderId } from '../../shared/ai'

export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export interface ToolSpec {
  name: string
  description: string
  parameters?: JsonSchema
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  id: string
  name: string
  content: string
}

/** The conversation in a provider-neutral shape; each adapter below maps it to its own wire format. */
export type LlmMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: ToolResult[] }

export interface LlmRequest {
  provider: AiProviderId
  model: string
  apiKey: string | null
  baseUrl: string
  system: string
  messages: LlmMessage[]
  tools: ToolSpec[]
  signal: AbortSignal
}

export interface LlmResponse {
  text: string
  toolCalls: ToolCall[]
  raw?: unknown
}

export type LlmErrorKind = 'no-key' | 'auth' | 'quota' | 'model' | 'network' | 'blocked' | 'bad-request' | 'server'

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    readonly status?: number
  ) {
    super(message)
  }
}

const REQUEST_TIMEOUT_MS = 60_000

export async function callLlm(req: LlmRequest): Promise<LlmResponse> {
  if (req.provider === 'gemini') return callGemini(req)
  return callOpenAiCompatible(req)
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, outer: AbortSignal): Promise<unknown> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS)
  const onAbort = (): void => timeout.abort()
  outer.addEventListener('abort', onAbort)
  try {
    let res: Response
    try {
      // Chromium's network stack, like the browser itself: it follows the system proxy and certificates.
      res = await net.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: timeout.signal
      })
    } catch (err) {
      if (outer.aborted) throw new LlmError('Cancelado.', 'network')
      if (timeout.signal.aborted) throw new LlmError(`A IA não respondeu em ${REQUEST_TIMEOUT_MS / 1000}s (${new URL(url).host}). Pode ser a rede, um proxy ou firewall bloqueando; ou o modelo está lento. Tente de novo ou troque o modelo em Configurações → Assistente.`, 'network')
      throw new LlmError(`Não consegui falar com o serviço de IA (${(err as Error).message}).`, 'network')
    }
    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      // not JSON: the status line is all there is
    }
    if (!res.ok) throw httpError(res.status, json, text)
    return json
  } finally {
    clearTimeout(timer)
    outer.removeEventListener('abort', onAbort)
  }
}

function httpError(status: number, json: unknown, text: string): LlmError {
  const detail =
    ((json as { error?: { message?: string } | string } | null)?.error as { message?: string } | undefined)?.message ??
    (typeof (json as { error?: string } | null)?.error === 'string' ? (json as { error: string }).error : '') ??
    ''
  const short = (detail || text).replace(/\s+/g, ' ').slice(0, 220)
  if (status === 401 || status === 403) return new LlmError(`A chave foi recusada pelo serviço. ${short}`, 'auth', status)
  if (status === 429) return new LlmError(`Limite de uso atingido por agora. Espere um pouco ou troque de modelo. ${short}`, 'quota', status)
  if (status === 404) return new LlmError(`Modelo ou endereço não encontrado. ${short}`, 'model', status)
  if (status >= 500) return new LlmError(`O serviço de IA está com problemas (${status}). ${short}`, 'server', status)
  return new LlmError(`Pedido recusado (${status}). ${short}`, 'bad-request', status)
}

// ---------------------------------------------------------------- Gemini

interface GeminiPart {
  text?: string
  thought?: boolean
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string }
  functionResponse?: unknown
  [k: string]: unknown
}

function geminiContents(messages: LlmMessage[]): unknown[] {
  const out: unknown[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: m.text }] })
    } else if (m.role === 'assistant') {
      // The model's own parts are replayed untouched when we have them: newer models attach opaque
      // "thought signatures" to their function calls and expect them back.
      const parts: unknown[] = Array.isArray(m.raw)
        ? (m.raw as unknown[])
        : [
            ...(m.text ? [{ text: m.text }] : []),
            ...(m.toolCalls ?? []).map((c) => ({ functionCall: { name: c.name, args: c.args } }))
          ]
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: ' ' }] })
    } else {
      out.push({
        role: 'user',
        parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { result: r.content } } }))
      })
    }
  }
  return out
}

async function callGemini(req: LlmRequest): Promise<LlmResponse> {
  if (!req.apiKey) throw new LlmError('Falta a chave do Google AI Studio.', 'no-key')
  const base = (req.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: geminiContents(req.messages),
    generationConfig: { temperature: 0.9, maxOutputTokens: 8192 }
  }
  if (req.tools.length) {
    body.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          ...(t.parameters && Object.keys(t.parameters.properties).length ? { parameters: t.parameters } : {})
        }))
      }
    ]
  }
  const json = (await postJson(
    `${base}/models/${encodeURIComponent(req.model)}:generateContent`,
    { 'x-goog-api-key': req.apiKey },
    body,
    req.signal
  )) as {
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
  }

  const candidate = json.candidates?.[0]
  if (!candidate) {
    const reason = json.promptFeedback?.blockReason
    throw new LlmError(reason ? `A IA recusou esse pedido (${reason}).` : 'A IA não devolveu resposta.', 'blocked')
  }
  const parts = candidate.content?.parts ?? []
  const text = parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim()
  const toolCalls: ToolCall[] = parts
    .filter((p) => p.functionCall)
    .map((p) => ({ id: p.functionCall?.id ?? randomUUID(), name: p.functionCall!.name, args: p.functionCall?.args ?? {} }))
  if (!text && !toolCalls.length && candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new LlmError(`A IA parou sem responder (${candidate.finishReason}).`, 'blocked')
  }
  return { text, toolCalls, raw: parts }
}

// ---------------------------------------------------------------- OpenAI-compatible

interface OpenAiToolCall {
  id?: string
  function?: { name?: string; arguments?: string }
}

function openAiMessages(system: string, messages: LlmMessage[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text })
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) }
              }))
            }
          : {})
      })
    } else {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content })
    }
  }
  return out
}

async function callOpenAiCompatible(req: LlmRequest): Promise<LlmResponse> {
  if (!req.baseUrl) throw new LlmError('Falta o endereço do serviço de IA.', 'model')
  const headers: Record<string, string> = {}
  if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`
  const url = `${req.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model: req.model,
    messages: openAiMessages(req.system, req.messages),
    temperature: 0.9,
    max_tokens: 2048
  }
  if (req.tools.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? { type: 'object', properties: {} }
      }
    }))
  }

  let json: { choices?: { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }[] }
  try {
    json = (await postJson(url, headers, body, req.signal)) as typeof json
  } catch (err) {
    // Some models (small local ones, a few free ones) reject `tools`: talk without actions instead of failing.
    if (err instanceof LlmError && err.kind === 'bad-request' && req.tools.length && /tool|function/i.test(err.message)) {
      delete body.tools
      json = (await postJson(url, headers, body, req.signal)) as typeof json
    } else {
      throw err
    }
  }

  const message = json.choices?.[0]?.message
  if (!message) throw new LlmError('A IA não devolveu resposta.', 'blocked')
  const text = (message.content ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const toolCalls: ToolCall[] = (message.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c) => {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(c.function?.arguments || '{}') as Record<string, unknown>
      } catch {
        // malformed arguments: the tool will complain about what is missing
      }
      return { id: c.id ?? randomUUID(), name: c.function!.name!, args }
    })
  return { text, toolCalls }
}

// ---------------------------------------------------------------- Model list

/** Asks the service which models the key can use, so nobody has to guess names. */
export async function listModels(provider: AiProviderId, baseUrl: string, apiKey: string | null): Promise<string[]> {
  const headers: Record<string, string> = {}
  const base = baseUrl.replace(/\/+$/, '')
  if (!base) throw new LlmError('Falta o endereço do serviço de IA.', 'model')
  const timeout = AbortSignal.timeout(15_000)
  let url = `${base}/models`
  if (provider === 'gemini') {
    if (!apiKey) throw new LlmError('Falta a chave do Google AI Studio.', 'no-key')
    headers['x-goog-api-key'] = apiKey
    url += '?pageSize=1000'
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }
  let res: Response
  try {
    res = await net.fetch(url, { headers, signal: timeout })
  } catch (err) {
    throw new LlmError(`Não consegui falar com o serviço de IA (${(err as Error).message}).`, 'network')
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }
  if (!res.ok) throw httpError(res.status, json, text)

  if (provider === 'gemini') {
    const models = (json as { models?: { name?: string; supportedGenerationMethods?: string[] }[] } | null)?.models ?? []
    return models
      .filter((m) => m.name && m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name!.replace(/^models\//, ''))
      .filter((n) => /^gemini/.test(n) && !/(tts|image|embedding|live|audio|robotics|computer-use)/.test(n))
      .sort()
      .reverse()
  }
  // OpenAI-compatible: { data: [{ id }] } (Ollama's /v1/models answers the same way)
  const data = (json as { data?: { id?: string }[] } | null)?.data ?? []
  return data.map((m) => m.id).filter((id): id is string => !!id).sort()
}
