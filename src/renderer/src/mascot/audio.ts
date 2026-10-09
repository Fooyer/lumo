import type { PersonaInfo } from '@shared/ai'

// ------------------------------------------------------------------ listening

export type ListenResult =
  | { kind: 'speech'; wav: string }
  | { kind: 'silence' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string }

interface ListenOptions {
  signal: AbortSignal
  onLevel: (level: number) => void
  /** Give up when nobody speaks for this long. */
  noSpeechMs?: number
  maxMs?: number
  /** How long a pause ends the sentence. */
  endSilenceMs?: number
}

const TARGET_RATE = 16_000

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

function toWavBase64(samples: Float32Array, rate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/**
 * Opens the microphone and records one sentence: it waits for speech, and stops after a pause (or the limits).
 * The result is a 16 kHz mono WAV, which every speech-to-text service takes.
 */
export async function listenOnce(opts: ListenOptions): Promise<ListenResult> {
  const { signal, onLevel, noSpeechMs = 9000, maxMs = 30_000, endSilenceMs = 1300 } = opts
  if (signal.aborted) return { kind: 'aborted' }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    })
  } catch (err) {
    const name = (err as DOMException).name
    return {
      kind: 'error',
      message:
        name === 'NotFoundError'
          ? 'Não encontrei nenhum microfone neste computador.'
          : 'Não consegui usar o microfone. Verifique se o Windows permite que o Lumo o use (Configurações → Privacidade → Microfone).'
    }
  }

  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(processor)
  processor.connect(mute)
  mute.connect(ctx.destination)

  const chunks: Float32Array[] = []
  const loudness: number[] = []
  let floor = 0
  let calibrated = 0
  let speechAt = -1
  let lastLoud = 0
  const startedAt = performance.now()

  return new Promise<ListenResult>((resolve) => {
    let done = false
    const finish = (result: ListenResult): void => {
      if (done) return
      done = true
      processor.onaudioprocess = null
      try {
        source.disconnect()
        processor.disconnect()
        mute.disconnect()
      } catch {
        // already disconnected
      }
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      onLevel(0)
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = (): void => finish({ kind: 'aborted' })
    signal.addEventListener('abort', onAbort)

    processor.onaudioprocess = (e) => {
      if (done) return
      const data = new Float32Array(e.inputBuffer.getChannelData(0))
      chunks.push(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      loudness.push(rms)
      onLevel(Math.min(1, rms * 9))

      const now = performance.now()
      // the first moments teach what the room sounds like
      if (calibrated < 6) {
        floor = (floor * calibrated + rms) / (calibrated + 1)
        calibrated++
        return
      }
      const threshold = Math.max(0.018, floor * 3)
      if (rms > threshold) {
        if (speechAt < 0) speechAt = chunks.length - 1
        lastLoud = now
      }
      if (speechAt >= 0 && now - lastLoud > endSilenceMs) return void finalize()
      if (speechAt < 0 && now - startedAt > noSpeechMs) return finish({ kind: 'silence' })
      if (now - startedAt > maxMs) return void finalize()
    }

    const finalize = (): void => {
      if (speechAt < 0) return finish({ kind: 'silence' })
      // keep a little of the silence before the first word, so it is not clipped
      const from = Math.max(0, speechAt - 4)
      const parts = chunks.slice(from)
      const total = parts.reduce((n, c) => n + c.length, 0)
      const all = new Float32Array(total)
      let offset = 0
      for (const c of parts) {
        all.set(c, offset)
        offset += c.length
      }
      const wav = toWavBase64(downsample(all, ctx.sampleRate, TARGET_RATE), TARGET_RATE)
      finish({ kind: 'speech', wav })
    }
  })
}

// ------------------------------------------------------------------ speaking

export interface Playback {
  done: Promise<void>
  stop: () => void
}

let playCtx: AudioContext | null = null

function pcmToFloat32(pcmBase64: string): Float32Array<ArrayBuffer> {
  const binary = atob(pcmBase64)
  const samples = new Float32Array(Math.floor(binary.length / 2))
  for (let i = 0; i < samples.length; i++) {
    let v = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8)
    if (v & 0x8000) v -= 0x10000
    samples[i] = v / 0x8000
  }
  return samples
}

/** Plays 16-bit mono PCM (base64) and reports its loudness while it plays, to move the mouth with it. */
export function playPcm(pcmBase64: string, sampleRate: number, onLevel: (level: number) => void): Playback {
  playCtx ??= new AudioContext()
  const ctx = playCtx
  const samples = pcmToFloat32(pcmBase64)
  const buffer = ctx.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(samples, 0)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  analyser.connect(ctx.destination)
  const data = new Uint8Array(analyser.fftSize)
  let stopped = false
  const meter = setInterval(() => {
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sum += v * v
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2))
  }, 40)
  const done = new Promise<void>((resolve) => {
    source.onended = () => {
      clearInterval(meter)
      onLevel(0)
      resolve()
    }
  })
  void ctx.resume().then(() => source.start())
  return {
    done,
    stop: () => {
      if (stopped) return
      stopped = true
      try {
        source.stop()
      } catch {
        // not started yet
      }
      clearInterval(meter)
      onLevel(0)
    }
  }
}

/** The system voice that best fits the character, when the speech service is not available. */
export function speakWithSystemVoice(text: string, persona: PersonaInfo, onStart: () => void): Playback {
  const synth = window.speechSynthesis
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'pt-BR'
  utter.pitch = persona.systemVoice.pitch
  utter.rate = persona.systemVoice.rate
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pt'))
  const lower = (v: SpeechSynthesisVoice): string => v.name.toLowerCase()
  const pick =
    voices.find((v) => persona.systemVoice.prefer.some((h) => lower(v).includes(h))) ??
    voices.find((v) => !persona.systemVoice.avoid.some((h) => lower(v).includes(h))) ??
    voices[0]
  if (pick) utter.voice = pick
  const done = new Promise<void>((resolve) => {
    utter.onstart = onStart
    utter.onend = () => resolve()
    utter.onerror = () => resolve()
  })
  synth.speak(utter)
  return { done, stop: () => synth.cancel() }
}

/** Short enough to be worth speaking: the first sentences, without links or marks. */
export function forSpeech(text: string): string {
  const clean = text
    .replace(/https?:\/\/\S+/g, 'o link')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= 420) return clean
  const cut = clean.slice(0, 420)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return end > 120 ? cut.slice(0, end + 1) : `${cut.trim()}…`
}

export interface StreamedSpeech extends Playback {
  /** True once the first sound is queued; false when the stream failed before any audio (use another voice then). */
  started: Promise<boolean>
}

/**
 * Speaks with the streamed Gemini voice: the audio is queued back to back as the pieces arrive, so she starts talking
 * after the first piece instead of after the whole sentence.
 */
export function speakStreamed(text: string, onLevel: (level: number) => void): StreamedSpeech {
  playCtx ??= new AudioContext()
  const ctx = playCtx
  const id = crypto.randomUUID()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.connect(ctx.destination)
  const data = new Uint8Array(analyser.fftSize)
  const meter = setInterval(() => {
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sum += v * v
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2))
  }, 40)

  const sources = new Set<AudioBufferSourceNode>()
  let nextAt = 0
  let ended = false
  let finished = false
  let began = false
  let resolveStarted!: (ok: boolean) => void
  let resolveDone!: () => void
  const started = new Promise<boolean>((r) => (resolveStarted = r))
  const done = new Promise<void>((r) => (resolveDone = r))

  const finish = (): void => {
    if (finished) return
    finished = true
    clearInterval(meter)
    off()
    onLevel(0)
    resolveStarted(began)
    resolveDone()
  }
  const settle = (): void => {
    if (ended && sources.size === 0) finish()
  }

  // Pieces are scheduled in the order they arrive, even when decoding an MP3 takes a moment.
  let queue: Promise<void> = Promise.resolve()
  const schedule = (buffer: AudioBuffer): void => {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(analyser)
    // A little lead on the first piece, then each one starts exactly where the last ends.
    const at = Math.max(ctx.currentTime + (began ? 0.01 : 0.06), nextAt)
    nextAt = at + buffer.duration
    sources.add(source)
    source.onended = () => {
      sources.delete(source)
      settle()
    }
    source.start(at)
    if (!began) {
      began = true
      resolveStarted(true)
    }
  }

  const off = window.lumo.onTtsChunk((chunk) => {
    if (chunk.id !== id || finished) return
    if (chunk.pcm && chunk.sampleRate) {
      const samples = pcmToFloat32(chunk.pcm)
      const buffer = ctx.createBuffer(1, samples.length, chunk.sampleRate)
      buffer.copyToChannel(samples, 0)
      queue = queue.then(() => (finished ? undefined : schedule(buffer)))
    } else if (chunk.mp3) {
      const bytes = Uint8Array.from(atob(chunk.mp3), (c) => c.charCodeAt(0))
      queue = queue.then(async () => {
        if (finished) return
        try {
          schedule(await ctx.decodeAudioData(bytes.buffer))
        } catch {
          // a sentence that cannot be decoded is skipped
        }
      })
    }
    if (chunk.done) {
      queue = queue.then(() => {
        ended = true
        settle()
      })
    }
  })

  void ctx.resume()
  void window.lumo.aiTtsStream(id, text)
  return {
    started,
    done,
    stop: () => {
      window.lumo.aiTtsCancel(id)
      for (const s of sources) {
        try {
          s.stop()
        } catch {
          // not started yet
        }
      }
      sources.clear()
      finish()
    }
  }
}
