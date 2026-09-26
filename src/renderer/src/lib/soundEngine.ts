import type { SoundEvent, SoundSettings } from '@shared/ipc'

/** The sounds in use: the parts (keys, tabs, music) may each come from a different mod. */
export interface ActiveSounds {
  music: string[]
  events: Partial<Record<SoundEvent, string[]>>
  /** No mod was chosen for that part, so Lumo's built-in sound plays. */
  builtinKeys: boolean
  builtinTabs: boolean
}

export type MusicStatus = 'off' | 'loading' | 'playing' | 'error'

// Events closer together than this are dropped instead of stacking (e.g. closing many tabs at once).
const MIN_GAP_MS: Record<SoundEvent, number> = {
  'tab-open': 60,
  'tab-close': 60,
  'key-letter': 0,
  'key-space': 0,
  'key-enter': 0,
  'key-backspace': 0
}

// How loud the music stays while a tab is playing sound, relative to its own volume.
const DUCKED_LEVEL = 0.2

const isKey = (event: SoundEvent): boolean => event.startsWith('key-')

class SoundEngine {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private settings: SoundSettings | null = null
  private sounds: ActiveSounds | null = null
  private buffers = new Map<string, AudioBuffer | null>()
  private cursor = new Map<SoundEvent, number>()
  private lastAt = new Map<SoundEvent, number>()

  private audio: HTMLAudioElement | null = null
  private musicKey = ''
  private track = 0
  private status: MusicStatus = 'off'
  private noise: AudioBuffer | null = null
  private tabAudible = false
  private duckLevel = 1
  private duckTimer: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<(s: MusicStatus) => void>()

  onMusicStatus(cb: (s: MusicStatus) => void): () => void {
    this.listeners.add(cb)
    cb(this.status)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private setStatus(s: MusicStatus): void {
    if (s === this.status) return
    this.status = s
    for (const cb of this.listeners) cb(s)
  }

  configure(settings: SoundSettings, sounds: ActiveSounds | null): void {
    this.settings = settings
    if (this.sounds !== sounds) {
      this.sounds = sounds
      this.cursor.clear()
    }
    if (settings.enabled) this.preload()
    if (this.out) this.out.gain.value = settings.volume / 100
    this.syncMusic()
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.out = this.ctx.createGain()
      this.out.gain.value = (this.settings?.volume ?? 60) / 100
      this.out.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** Decodes the active mod's effect sounds ahead of time so the first key press isn't late. */
  private preload(): void {
    if (!this.sounds) return
    const ctx = this.context()
    for (const list of Object.values(this.sounds.events)) {
      for (const url of list ?? []) {
        if (this.buffers.has(url)) continue
        this.buffers.set(url, null)
        fetch(url)
          .then((r) => r.arrayBuffer())
          .then((data) => ctx.decodeAudioData(data))
          .then((buffer) => this.buffers.set(url, buffer))
          .catch(() => this.buffers.delete(url))
      }
    }
  }

  play(event: SoundEvent, force = false): void {
    const s = this.settings
    if (!force && (!s?.enabled || (isKey(event) ? !s.keyboard : !s.tabs))) return
    const now = performance.now()
    if (now - (this.lastAt.get(event) ?? -Infinity) < MIN_GAP_MS[event]) return
    this.lastAt.set(event, now)

    const ctx = this.context()
    const list = this.sounds?.events[event]
    if (list?.length) {
      // A list plays in the order given, then starts over.
      const i = (this.cursor.get(event) ?? 0) % list.length
      this.cursor.set(event, i + 1)
      const buffer = this.buffers.get(list[i])
      if (buffer) {
        const src = ctx.createBufferSource()
        src.buffer = buffer
        src.connect(this.out!)
        src.start()
      } else this.preload()
      return
    }
    // A mod that doesn't cover an event stays silent for it; the built-in sound is only for parts with no mod.
    const builtin = isKey(event) ? this.sounds?.builtinKeys ?? true : this.sounds?.builtinTabs ?? true
    if (builtin) this.synth(ctx, event)
  }

  /** Lumo's own sounds, synthesized so nothing has to be shipped: mechanical-keyboard keys and short sweeps for tabs. */
  private synth(ctx: AudioContext, event: SoundEvent): void {
    const t = ctx.currentTime
    const out = this.out!
    if (event === 'tab-open' || event === 'tab-close') {
      const up = event === 'tab-open'
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(up ? 420 : 720, t)
      osc.frequency.exponentialRampToValueAtTime(up ? 840 : 300, t + 0.12)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.connect(g).connect(out)
      osc.start(t)
      osc.stop(t + 0.18)
      return
    }
    this.thock(ctx, out, t, event)
  }

  /**
   * A mechanical-keyboard key: a sharp plastic click on top of a short, round "pop" whose pitch drops as it
   * decays. Each press is nudged a little in pitch so a run of keys doesn't sound like one sample repeated.
   */
  private thock(ctx: AudioContext, out: AudioNode, t: number, event: SoundEvent): void {
    const key: Record<string, { body: number; decay: number; gain: number; click: number }> = {
      'key-letter': { body: 210, decay: 0.09, gain: 0.85, click: 0.5 },
      'key-space': { body: 135, decay: 0.15, gain: 1, click: 0.4 },
      'key-enter': { body: 160, decay: 0.13, gain: 1, click: 0.55 },
      'key-backspace': { body: 250, decay: 0.08, gain: 0.8, click: 0.5 }
    }
    const k = key[event]
    const jitter = 0.94 + Math.random() * 0.12

    // The pop: a sine that starts high and falls fast onto the body's pitch.
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(k.body * 2.2 * jitter, t)
    osc.frequency.exponentialRampToValueAtTime(k.body * jitter, t + 0.03)
    const body = ctx.createGain()
    body.gain.setValueAtTime(0.0001, t)
    body.gain.exponentialRampToValueAtTime(k.gain, t + 0.002)
    body.gain.exponentialRampToValueAtTime(0.0001, t + k.decay)
    osc.connect(body).connect(out)
    osc.start(t)
    osc.stop(t + k.decay + 0.02)

    // The click: a few milliseconds of high-passed noise (the switch and the keycap hitting the plate).
    const frames = Math.floor(ctx.sampleRate * 0.012)
    if (!this.noise || this.noise.length !== frames) {
      this.noise = ctx.createBuffer(1, frames, ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3
    }
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2500 * jitter
    const click = ctx.createGain()
    click.gain.value = k.click
    src.connect(hp).connect(click).connect(out)
    src.start(t)
  }

  /** A tab started or stopped playing sound: the music makes room for it, then comes back. */
  setTabAudible(audible: boolean): void {
    this.tabAudible = audible
    this.fadeDuck()
  }

  private fadeDuck(): void {
    if (this.duckTimer) return
    const step = (): void => {
      const target = this.tabAudible && this.settings?.duckMusic ? DUCKED_LEVEL : 1
      const delta = target - this.duckLevel
      // About 0.4s from full volume to ducked, and back.
      this.duckLevel = Math.abs(delta) < 0.03 ? target : this.duckLevel + Math.sign(delta) * 0.04
      this.applyMusicVolume()
      if (this.duckLevel === target && this.duckTimer) {
        clearInterval(this.duckTimer)
        this.duckTimer = null
      }
    }
    this.duckTimer = setInterval(step, 20)
    step()
  }

  private applyMusicVolume(): void {
    if (this.audio) this.audio.volume = ((this.settings?.musicVolume ?? 40) / 100) * this.duckLevel
  }

  // ---- Background music -------------------------------------------------------------------------

  private syncMusic(): void {
    const s = this.settings
    const tracks = s?.musicSource === 'mod' ? this.sounds?.music ?? [] : []
    const radio = s?.musicSource === 'radio' ? s.radioUrl.trim() : ''
    const wanted = !!s?.music && (tracks.length > 0 || /^https?:\/\//i.test(radio))
    if (!wanted) {
      this.stopMusic()
      return
    }
    if (!this.audio) {
      const audio = new Audio()
      audio.preload = 'none'
      audio.addEventListener('playing', () => this.setStatus('playing'))
      audio.addEventListener('waiting', () => this.setStatus('loading'))
      audio.addEventListener('error', () => this.setStatus('error'))
      audio.addEventListener('ended', () => {
        // A radio stream doesn't end; a mod's tracks play one after another, in a loop.
        const list = this.settings?.musicSource === 'mod' ? this.sounds?.music ?? [] : []
        if (list.length === 0) return
        this.track = (this.track + 1) % list.length
        audio.src = list[this.track]
        void audio.play().catch(() => this.setStatus('error'))
      })
      this.audio = audio
    }
    this.fadeDuck()

    // Re-pointing the element restarts the stream, so only do it when the source actually changed.
    const key = tracks.length ? `mod:${tracks.join('|')}` : `radio:${radio}`
    if (key === this.musicKey && !this.audio.paused) return
    if (key !== this.musicKey) {
      this.musicKey = key
      this.track = 0
      this.audio.src = tracks.length ? tracks[0] : radio
    }
    this.setStatus('loading')
    void this.audio.play().catch(() => this.setStatus('error'))
  }

  private stopMusic(): void {
    if (this.audio) {
      this.audio.pause()
      // Dropping the source closes a live stream instead of leaving it buffering in the background.
      this.audio.removeAttribute('src')
      this.audio.load()
    }
    this.musicKey = ''
    this.setStatus('off')
  }
}

export const soundEngine = new SoundEngine()
