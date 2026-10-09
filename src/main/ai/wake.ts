import type { WakeResult, WakeStatus } from '../../shared/ai'

/**
 * "Hey Lumi": listens for the character's name without sending anything anywhere. The renderer cuts the microphone
 * into short utterances and sends each one here; a small speech model (Whisper base, run on this computer through
 * onnxruntime) writes it down, and only the text is compared with the wake words.
 */

const MODEL = 'onnx-community/whisper-base'
/** The model is dropped from memory after this long without a clip. */
const IDLE_UNLOAD_MS = 10 * 60_000
const MAX_QUEUE = 1

// What a recognizer tends to write for the names of the characters (the model hears "Lux" as "lucs", and so on).
const BUILT_IN_ALIASES: Record<string, string[]> = {
  lumi: ['lumi', 'lume', 'lumy', 'lumie', 'lumii', 'lummy', 'lumia'],
  lux: ['lux', 'luks', 'lucs', 'lucks', 'luxi', 'luckis', 'lukis']
}
const FILLERS = new Set(['ei', 'oi', 'ola', 'ok', 'okay', 'hey', 'opa', 'e', 'fala', 'bom', 'dia', 'psiu', 'oh', 'ah'])

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

/** Whether a wake word opens the sentence, and what came after it. */
export function wakeMatch(text: string, words: string[]): { matched: boolean; rest: string } {
  const originals = text.trim().split(/\s+/).filter(Boolean)
  const tokens = originals.map(normalize)
  const wanted = words.map(normalize).filter(Boolean)
  if (!tokens.length || !wanted.length) return { matched: false, rest: text }

  const isWake = (candidate: string): boolean =>
    wanted.some((w) => {
      if (candidate === w) return true
      if (BUILT_IN_ALIASES[w]?.includes(candidate)) return true
      // other words get one slip of the recognizer, but only when they are long enough not to clash with others
      return w.length >= 5 && candidate.length >= 4 && distance(candidate, w) <= 1
    })

  // the name has to be one of the first words ("ei lumi, abre o youtube"); a pair of tokens covers a word split in two
  for (let i = 0; i < Math.min(3, tokens.length); i++) {
    if (i > 0 && !tokens.slice(0, i).every((t) => FILLERS.has(t) || t === '')) break
    const cuts = [1, 2]
    for (const n of cuts) {
      if (i + n > tokens.length) continue
      const candidate = tokens.slice(i, i + n).join('')
      if (candidate && isWake(candidate)) {
        return { matched: true, rest: originals.slice(i + n).join(' ').replace(/^[\s,.:;!?-]+/, '') }
      }
    }
  }
  return { matched: false, rest: text }
}

/** Drops a leading wake word from a transcript ("Lumi, abre o youtube" → "abre o youtube"). */
export function stripWake(text: string, words: string[]): string {
  const m = wakeMatch(text, words)
  return m.matched && m.rest.trim() ? m.rest.trim() : text
}

/** 16-bit mono PCM WAV → samples in -1..1 (it finds the data chunk, wherever the writer put it). */
function wavSamples(wav: Buffer): Float32Array {
  let offset = 12
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'data') {
      const end = Math.min(wav.length, offset + 8 + size)
      const n = Math.floor((end - offset - 8) / 2)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(offset + 8 + i * 2) / 32768
      return out
    }
    offset += 8 + size + (size % 2)
  }
  return new Float32Array(0)
}

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>

export class WakeEngine {
  private state: WakeStatus = { state: 'idle', progress: 0 }
  private asr: Transcriber | null = null
  private loading: Promise<void> | null = null
  private pending = 0
  private chain: Promise<unknown> = Promise.resolve()
  private unloadTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private cacheDir: string) {}

  status(): WakeStatus {
    return { ...this.state }
  }

  /** Downloads (first time only) and loads the model. Safe to call again while it runs. */
  prepare(): Promise<void> {
    if (this.asr) return Promise.resolve()
    if (this.loading) return this.loading
    this.state = { state: 'downloading', progress: 0 }
    this.loading = (async () => {
      try {
        const { pipeline, env } = await import('@huggingface/transformers')
        env.cacheDir = this.cacheDir
        const files = new Map<string, { loaded: number; total: number }>()
        const asr = await pipeline('automatic-speech-recognition', MODEL, {
          dtype: 'q8',
          device: 'cpu',
          progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
            if (p.status === 'progress' && p.file && p.total) files.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
            let loaded = 0
            let total = 0
            for (const f of files.values()) {
              loaded += f.loaded
              total += f.total
            }
            if (total > 0) this.state = { state: 'downloading', progress: Math.min(0.99, loaded / total) }
          }
        })
        this.asr = asr as unknown as Transcriber
        this.state = { state: 'ready', progress: 1 }
      } catch (err) {
        this.state = { state: 'error', progress: 0, message: `Não consegui preparar o reconhecimento local: ${(err as Error).message}` }
        throw err
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  /** Writes down one utterance and says whether it opens with a wake word. Clips pile up at most one deep. */
  async check(wav: Buffer, words: string[]): Promise<WakeResult> {
    if (!this.asr) {
      if (this.state.state === 'error') return { wake: false, hasCommand: false, text: '' }
      await this.prepare()
    }
    if (this.pending >= MAX_QUEUE + 1) return { wake: false, hasCommand: false, text: '' }
    this.pending++
    const run = this.chain.then(async (): Promise<WakeResult> => {
      const samples = wavSamples(wav)
      if (!this.asr || samples.length < 16000 * 0.3) return { wake: false, hasCommand: false, text: '' }
      const out = await this.asr(samples, { language: 'portuguese', task: 'transcribe' })
      const text = (Array.isArray(out) ? out[0]?.text : out.text)?.trim() ?? ''
      const m = wakeMatch(text, words)
      const letters = m.rest.replace(/[^\p{L}\p{N}]/gu, '')
      return { wake: m.matched, hasCommand: m.matched && letters.length >= 4, text }
    })
    this.chain = run.catch(() => undefined)
    try {
      return await run
    } finally {
      this.pending--
      this.scheduleUnload()
    }
  }

  private scheduleUnload(): void {
    if (this.unloadTimer) clearTimeout(this.unloadTimer)
    this.unloadTimer = setTimeout(() => this.dispose(), IDLE_UNLOAD_MS)
    this.unloadTimer.unref?.()
  }

  dispose(): void {
    if (this.unloadTimer) clearTimeout(this.unloadTimer)
    this.unloadTimer = null
    this.asr = null
    if (this.state.state === 'ready') this.state = { state: 'idle', progress: 0 }
  }
}
