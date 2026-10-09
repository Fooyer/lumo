import { toWavBase64, downsample } from './audio'

/**
 * Keeps the microphone open and cuts what it hears into utterances (a burst of speech between two pauses).
 * Nothing is recorded to disk and nothing leaves the computer from here: every utterance goes to the main process,
 * where a local model checks whether it opens with the wake word. While `shouldListen()` says no (she is talking,
 * or already listening), what the microphone hears is thrown away.
 */

const TARGET_RATE = 16_000
const END_SILENCE_MS = 650
const MIN_SPEECH_MS = 280
const MAX_UTTERANCE_MS = 7000
const PRE_ROLL_CHUNKS = 3

interface Options {
  shouldListen: () => boolean
  onUtterance: (wav: string) => void
  onError: (message: string) => void
}

export class WakeListener {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private stopped = false

  constructor(private o: Options) {}

  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      })
    } catch (err) {
      this.o.onError(
        (err as DOMException).name === 'NotFoundError'
          ? 'Não encontrei nenhum microfone para ouvir o meu nome.'
          : 'Não consegui usar o microfone para ouvir o meu nome. Verifique se o Windows permite que o Lumo o use (Configurações → Privacidade → Microfone).'
      )
      return false
    }
    if (this.stopped) {
      this.stream.getTracks().forEach((t) => t.stop())
      return false
    }

    const ctx = new AudioContext()
    this.ctx = ctx
    const source = ctx.createMediaStreamSource(this.stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(processor)
    processor.connect(mute)
    mute.connect(ctx.destination)

    let floor = 0.006
    let chunks: Float32Array[] = []
    let recording = false
    let speechMs = 0
    let lastLoud = 0
    let startedAt = 0
    const preRoll: Float32Array[] = []

    const finish = (): void => {
      const enough = speechMs >= MIN_SPEECH_MS
      const parts = chunks
      chunks = []
      recording = false
      speechMs = 0
      if (!enough) return
      const total = parts.reduce((n, c) => n + c.length, 0)
      const all = new Float32Array(total)
      let offset = 0
      for (const c of parts) {
        all.set(c, offset)
        offset += c.length
      }
      this.o.onUtterance(toWavBase64(downsample(all, ctx.sampleRate, TARGET_RATE), TARGET_RATE))
    }

    processor.onaudioprocess = (e) => {
      if (this.stopped) return
      const data = new Float32Array(e.inputBuffer.getChannelData(0))
      const blockMs = (data.length / ctx.sampleRate) * 1000
      const now = performance.now()

      if (!this.o.shouldListen()) {
        chunks = []
        recording = false
        speechMs = 0
        preRoll.length = 0
        return
      }

      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      const loud = rms > Math.max(0.02, floor * 3.5)
      // the room's own noise level, followed slowly and only while nobody is talking
      if (!loud && !recording) floor = floor * 0.97 + rms * 0.03

      if (!recording) {
        preRoll.push(data)
        if (preRoll.length > PRE_ROLL_CHUNKS) preRoll.shift()
        if (loud) {
          recording = true
          chunks = [...preRoll]
          preRoll.length = 0
          speechMs = blockMs
          lastLoud = now
          startedAt = now
        }
        return
      }

      chunks.push(data)
      if (loud) {
        speechMs += blockMs
        lastLoud = now
      }
      if (now - lastLoud > END_SILENCE_MS || now - startedAt > MAX_UTTERANCE_MS) finish()
    }
    return true
  }

  stop(): void {
    this.stopped = true
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}
