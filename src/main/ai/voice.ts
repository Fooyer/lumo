import { net } from 'electron'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { providerInfo, type AiProviderId, type AssistantSettings, type PersonaInfo, type TtsResult } from '../../shared/ai'
import type { AiStore } from './aiStore'

const TTS_MODEL = 'gemini-2.5-flash-preview-tts'
const TTS_SAMPLE_RATE = 24_000
const TIMEOUT_MS = 45_000
// Server-sent events: blank line between events.
const NL = '\n'
const EVENT_END = /\r?\n\r?\n/
const EVENT_START = /^\r?\n\r?\n/

interface Ready {
  provider: AiProviderId
  baseUrl: string
  apiKey: string
  model: string
}

/** Providers that can turn speech into text, in order of preference after the one the user picked. */
const STT_CAPABLE: AiProviderId[] = ['gemini', 'groq', 'openai']

function resolve(store: AiStore, cfg: AssistantSettings, provider: AiProviderId, useModel: boolean): Ready | null {
  const info = providerInfo(provider)
  const apiKey = store.getKey(provider)
  if (!apiKey) return null
  return {
    provider,
    baseUrl: (provider === cfg.provider && cfg.baseUrl.trim()) || info.baseUrl,
    apiKey,
    model: (useModel && provider === cfg.provider && cfg.model.trim()) || info.defaultModel
  }
}

/** The service that will listen: the chosen one when it can, otherwise any other with a saved key. */
function sttProvider(store: AiStore, cfg: AssistantSettings): Ready | null {
  const order = [cfg.provider, ...STT_CAPABLE.filter((p) => p !== cfg.provider)].filter((p) => STT_CAPABLE.includes(p))
  for (const p of order) {
    const r = resolve(store, cfg, p, true)
    if (r) return r
  }
  return null
}

async function post(url: string, init: RequestInit): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await net.fetch(url, { ...init, method: 'POST', signal: ctl.signal })
    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      // not JSON
    }
    if (!res.ok) {
      const msg = (json as { error?: { message?: string } } | null)?.error?.message ?? text
      const e = new Error(`${res.status}: ${msg.replace(/\s+/g, ' ').slice(0, 200)}`)
      ;(e as Error & { status?: number }).status = res.status
      throw e
    }
    return json
  } catch (err) {
    if (ctl.signal.aborted) throw new Error('O serviço demorou demais para responder.')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Speech (a 16-bit mono WAV, base64) → text. */
export async function transcribe(store: AiStore, cfg: AssistantSettings, wavBase64: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const r = sttProvider(store, cfg)
  if (!r) {
    return {
      ok: false,
      error: 'Para entender sua voz eu preciso de uma chave do Google AI Studio (Gemini), do Groq ou da OpenAI. Salve uma em Configurações → Lumi.'
    }
  }
  try {
    if (r.provider === 'gemini') {
      const json = (await post(`${r.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(r.model)}:generateContent`, {
        headers: { 'content-type': 'application/json', 'x-goog-api-key': r.apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'Transcreva exatamente o que a pessoa diz neste áudio, em português do Brasil. Responda SOMENTE com a transcrição, sem aspas nem comentários. Se não houver fala clara, responda com uma resposta vazia.'
                },
                { inlineData: { mimeType: 'audio/wav', data: wavBase64 } }
              ]
            }
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 1024 }
        })
      })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
      return { ok: true, text }
    }
    // Whisper-style endpoint (Groq, OpenAI)
    const form = new FormData()
    form.append('file', new Blob([Buffer.from(wavBase64, 'base64')], { type: 'audio/wav' }), 'voz.wav')
    form.append('model', r.provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1')
    form.append('language', 'pt')
    form.append('response_format', 'json')
    const json = (await post(`${r.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      headers: { authorization: `Bearer ${r.apiKey}` },
      body: form
    })) as { text?: string }
    return { ok: true, text: (json.text ?? '').trim() }
  } catch (err) {
    return { ok: false, error: `Não consegui transcrever o áudio. ${(err as Error).message}` }
  }
}

/** Text → speech with the persona's Gemini voice. Fails softly: the caller falls back to the system voice. */
export async function synthesize(store: AiStore, cfg: AssistantSettings, persona: PersonaInfo, text: string): Promise<TtsResult> {
  const r = resolve(store, cfg, 'gemini', false)
  if (!r) return { ok: false, error: 'sem chave do Gemini' }
  try {
    const json = (await post(`${r.baseUrl.replace(/\/+$/, '')}/models/${TTS_MODEL}:generateContent`, {
      headers: { 'content-type': 'application/json', 'x-goog-api-key': r.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${persona.ttsStyle}${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: persona.ttsVoice } } }
        }
      })
    })) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] }
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    if (!part?.inlineData?.data) return { ok: false, error: 'o serviço não devolveu áudio' }
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1]) || TTS_SAMPLE_RATE
    return { ok: true, pcm: part.inlineData.data, sampleRate: rate }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Same voice, but streamed: the service sends the audio while it is still making it, so the first sound arrives
 * after a moment instead of after the whole sentence. Each piece goes to `onPcm` (16-bit mono, base64).
 */
export async function synthesizeStream(
  store: AiStore,
  cfg: AssistantSettings,
  persona: PersonaInfo,
  text: string,
  onPcm: (pcm: string, sampleRate: number) => void,
  signal: AbortSignal
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = resolve(store, cfg, 'gemini', false)
  if (!r) return { ok: false, error: 'sem chave do Gemini' }
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  const ctl = new AbortController()
  const onAbort = (): void => ctl.abort()
  signal.addEventListener('abort', onAbort)
  try {
    const res = await net.fetch(`${r.baseUrl.replace(/\/+$/, '')}/models/${TTS_MODEL}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': r.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${persona.ttsStyle}${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: persona.ttsVoice } } }
        }
      }),
      signal: ctl.signal
    })
    if (!res.ok || !res.body) return { ok: false, error: `${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 160)}` }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let spare: Buffer | null = null // a 16-bit sample must not be split between two pieces
    let sent = false
    const handle = (event: string): void => {
      const data = event.split(NL).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
      if (!data) return
      let json: { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] }
      try {
        json = JSON.parse(data)
      } catch {
        return
      }
      for (const part of json.candidates?.[0]?.content?.parts ?? []) {
        if (!part.inlineData?.data) continue
        let bytes = Buffer.from(part.inlineData.data, 'base64')
        if (spare) bytes = Buffer.concat([spare, bytes])
        spare = bytes.length % 2 ? bytes.subarray(bytes.length - 1) : null
        if (spare) bytes = bytes.subarray(0, bytes.length - 1)
        if (!bytes.length) continue
        const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1]) || TTS_SAMPLE_RATE
        sent = true
        onPcm(bytes.toString('base64'), rate)
      }
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut: number
      while ((cut = buffer.search(EVENT_END)) >= 0) {
        handle(buffer.slice(0, cut))
        buffer = buffer.slice(cut).replace(EVENT_START, '')
      }
    }
    if (buffer.trim()) handle(buffer)
    return sent ? { ok: true } : { ok: false, error: 'o serviço não devolveu áudio' }
  } catch (err) {
    return { ok: false, error: signal.aborted ? 'cancelado' : ctl.signal.aborted ? 'o serviço demorou demais' : (err as Error).message }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

// ---------------------------------------------------------------- Microsoft neural voice

const edgeClients = new Map<string, Promise<MsEdgeTTS>>()

function edgeClient(voice: string): Promise<MsEdgeTTS> {
  let client = edgeClients.get(voice)
  if (!client) {
    const tts = new MsEdgeTTS()
    client = tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3).then(() => tts)
    // a failed or dropped connection is rebuilt on the next request
    client.catch(() => edgeClients.delete(voice))
    edgeClients.set(voice, client)
  }
  return client
}

/** Opens the connection ahead of time so the first sentence does not pay for it. */
export function warmEdge(persona: PersonaInfo): void {
  void edgeClient(persona.edgeVoice.name).catch(() => {})
}

/** Short sentences first: the first one decides how long she takes to start. */
function sentencesOf(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]*\s*/g)?.map((x) => x.trim()).filter(Boolean) ?? [text]
  const out: string[] = []
  for (const part of parts) {
    const last = out[out.length - 1]
    if (last !== undefined && (last.length < 22 || (out.length > 1 && last.length + part.length < 160))) out[out.length - 1] = `${last} ${part}`
    else out.push(part)
  }
  return out
}

function escapeXml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

function edgeSentence(tts: MsEdgeTTS, text: string, persona: PersonaInfo, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { audioStream } = tts.toStream(escapeXml(text), { pitch: persona.edgeVoice.pitch, rate: persona.edgeVoice.rate })
    const parts: Buffer[] = []
    const onAbort = (): void => {
      audioStream.destroy()
      reject(new Error('cancelado'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      audioStream.destroy()
      reject(new Error('a voz demorou demais'))
    }, 20_000)
    audioStream.on('data', (d: Buffer) => parts.push(d))
    audioStream.on('end', () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(Buffer.concat(parts))
    })
    audioStream.on('error', (e: Error) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(e)
    })
  })
}

/** Speaks with Microsoft's neural voice, one sentence at a time; each finished sentence goes to `onMp3` at once. */
export async function synthesizeEdge(
  persona: PersonaInfo,
  text: string,
  onMp3: (mp3: string) => void,
  signal: AbortSignal
): Promise<{ ok: true } | { ok: false; error: string }> {
  let sent = false
  try {
    for (const sentence of sentencesOf(text)) {
      if (signal.aborted) return { ok: false, error: 'cancelado' }
      let audio: Buffer
      try {
        audio = await edgeSentence(await edgeClient(persona.edgeVoice.name), sentence, persona, signal)
      } catch (err) {
        if (signal.aborted) throw err
        // the connection may have gone stale: one retry on a fresh one
        edgeClients.delete(persona.edgeVoice.name)
        audio = await edgeSentence(await edgeClient(persona.edgeVoice.name), sentence, persona, signal)
      }
      if (!audio.length) continue
      sent = true
      onMp3(audio.toString('base64'))
    }
    return sent ? { ok: true } : { ok: false, error: 'a voz não devolveu áudio' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
