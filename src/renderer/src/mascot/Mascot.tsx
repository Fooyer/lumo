import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMOTE_TAGS,
  PERSONAS,
  parseEmoteTags,
  type AiEvent,
  type AssistantSettings,
  type MascotBrowserEvent,
  type MascotCommand,
  type OfferOption,
  type PersonaId,
  type VoiceState
} from '@shared/ai'
import { useTheme } from '../lib/useTheme'
import MascotSvg, { GROUND_Y, SVG_H, SVG_W } from './MascotSvg'
import { Rig, REST } from './rig'
import { Brain, type FxKind } from './brain'
import { chime, forSpeech, listenOnce, playPcm, speakStreamed, speakWithSystemVoice, type Playback } from './audio'
import { WakeListener } from './wake'

const BASE_K = 0.6
const FX_SIDE = 34
const FX_TOP = 52
const BUBBLE_W = 244
const BUBBLE_GAP = 8
const CLICK_DELAY_MS = 260
/** Room on each side of her for the two options she holds out. */
const OFFER_PAD = 84
const DRAG_THRESHOLD = 5
/** After this many rounds without anyone speaking, the hands-free mode switches itself off. */
const MAX_EMPTY_ROUNDS = 3

interface Fx {
  id: number
  kind: FxKind
  dx: number
  dy: number
}

interface Bubble {
  id: number
  text: string
}

let fxId = 1

function plain(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function Mascot(): JSX.Element {
  useTheme()
  const svgRef = useRef<SVGSVGElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const meterRef = useRef<HTMLSpanElement>(null)
  const brainRef = useRef<Brain | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const settingsRef = useRef<AssistantSettings | null>(null)
  const chatOpenRef = useRef(false)
  const bubbleActiveRef = useRef(false)
  const lastRectRef = useRef('')
  const stageReadyRef = useRef(false)
  const scaleRef = useRef(1)
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [offer, setOffer] = useState<OfferOption[] | null>(null)
  const offerRef = useRef(false)
  const [fx, setFx] = useState<Fx[]>([])
  const [scale, setScale] = useState(1)
  const [persona, setPersona] = useState<PersonaId>('girl')
  const [voiceUi, setVoiceUi] = useState<VoiceState>('idle')
  const personaRef = useRef<PersonaId>('girl')

  // ---- voice controller state (refs: it lives across renders)
  const voiceRef = useRef<VoiceState>('idle')
  const listenAbort = useRef<AbortController | null>(null)
  const playback = useRef<Playback | null>(null)
  const emptyRounds = useRef(0)
  const awaitingReply = useRef(false)
  const startListeningRef = useRef<() => void>(() => {})

  /** Right after she stops talking the microphone may still catch her own voice: it is ignored for a moment. */
  const quietUntil = useRef(0)

  const setVoice = useCallback((state: VoiceState) => {
    if (voiceRef.current === state) return
    if (voiceRef.current === 'speaking') quietUntil.current = performance.now() + 900
    voiceRef.current = state
    setVoiceUi(state)
    brainRef.current?.setListening(state === 'listening')
    window.lumo.reportVoiceState(state)
  }, [])

  const emitFx = useCallback((kind: FxKind) => {
    if (!brainRef.current) return
    const item: Fx = { id: fxId++, kind, dx: (Math.random() - 0.5) * 50, dy: 0 }
    setFx((list) => [...list.slice(-8), item])
    setTimeout(() => setFx((list) => list.filter((f) => f.id !== item.id)), 1900)
  }, [])

  const say = useCallback((text: string, ms?: number) => {
    const clean = plain(text)
    if (!clean || chatOpenRef.current) return
    const shown = clean.length > 190 ? `${clean.slice(0, 187)}…` : clean
    setBubble({ id: fxId++, text: shown })
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
    bubbleTimer.current = setTimeout(() => setBubble(null), ms ?? Math.min(13000, Math.max(4200, shown.length * 62)))
  }, [])

  // ---------------------------------------------------------------- speaking
  const stopSpeaking = useCallback(() => {
    playback.current?.stop()
    playback.current = null
    brainRef.current?.stopTalking()
    if (voiceRef.current === 'speaking') setVoice('idle')
  }, [setVoice])

  /** Speaks a reply with the character's voice; resolves when she has finished (or was interrupted). */
  const speak = useCallback(
    async (text: string): Promise<void> => {
      const brain = brainRef.current
      const spoken = forSpeech(text)
      if (!brain || !spoken) return
      if (!settingsRef.current?.voice) {
        brain.talk(Math.min(8000, spoken.length * 55))
        return
      }
      stopSpeaking()
      const info = PERSONAS[personaRef.current]
      setVoice('speaking')
      brain.talk(60_000)
      let current: Playback | null = null
      try {
        if (settingsRef.current?.voiceEngine !== 'system') {
          const streamed = speakStreamed(spoken, (level) => brain.setMouthLevel(level))
          playback.current = current = streamed
          const ok = await streamed.started
          if (voiceRef.current !== 'speaking') {
            streamed.stop() // interrupted while the voice was being made
            return
          }
          if (ok) {
            await streamed.done
          } else if ('speechSynthesis' in window) {
            current = speakWithSystemVoice(spoken, info, () => brain.talk(60_000))
            playback.current = current
            await current.done
          }
        } else if ('speechSynthesis' in window) {
          current = speakWithSystemVoice(spoken, info, () => brain.talk(60_000))
          playback.current = current
          await current.done
        }
      } catch {
        // no sound: she still moves her mouth for a moment
      } finally {
        if (playback.current === current) playback.current = null
        brain.stopTalking()
        if (voiceRef.current === 'speaking') setVoice('idle')
      }
    },
    [setVoice, stopSpeaking]
  )

  // ---------------------------------------------------------------- listening
  const stopListening = useCallback(() => {
    listenAbort.current?.abort()
    listenAbort.current = null
  }, [])

  const startListening = useCallback(async (): Promise<void> => {
    if (voiceRef.current === 'listening' || voiceRef.current === 'transcribing') return
    stopSpeaking()
    const abort = new AbortController()
    listenAbort.current = abort
    setVoice('listening')
    const result = await listenOnce({
      signal: abort.signal,
      onLevel: (level) => meterRef.current?.style.setProperty('--lvl', String(level))
    })
    if (listenAbort.current === abort) listenAbort.current = null
    const voiceMode = settingsRef.current?.voiceMode === true

    if (result.kind === 'aborted') return void setVoice('idle')
    if (result.kind === 'error') {
      setVoice('idle')
      if (voiceMode) await window.lumo.setSettings({ assistant: { ...(settingsRef.current as AssistantSettings), voiceMode: false } })
      emitErrorToChat(result.message)
      return
    }
    if (result.kind === 'silence') {
      setVoice('idle')
      emptyRounds.current++
      if (voiceMode && emptyRounds.current < MAX_EMPTY_ROUNDS) setTimeout(() => startListeningRef.current(), 250)
      else if (voiceMode) {
        window.lumo.setSettings({ assistant: { ...(settingsRef.current as AssistantSettings), voiceMode: false } })
        say('Ninguém falou, então parei de ouvir. Clique em mim ou use Ctrl+Shift+M quando quiser.', 6000)
      }
      return
    }

    setVoice('transcribing')
    const sent = await window.lumo.aiVoiceSend(result.wav)
    setVoice('idle')
    if (!sent.ok) {
      if (voiceMode) await window.lumo.setSettings({ assistant: { ...(settingsRef.current as AssistantSettings), voiceMode: false } })
      emitErrorToChat(sent.error ?? 'Não consegui entender o áudio.')
      return
    }
    if (!sent.text) {
      emptyRounds.current++
      if (voiceMode && emptyRounds.current < MAX_EMPTY_ROUNDS) setTimeout(() => startListeningRef.current(), 250)
      return
    }
    emptyRounds.current = 0
    awaitingReply.current = true
  }, [say, setVoice, stopSpeaking])

  // errors from the voice layer go to the chat as well (the bubble is hidden while the chat is open)
  function emitErrorToChat(message: string): void {
    void window.lumo.reportVoiceError(message)
  }

  useEffect(() => {
    startListeningRef.current = () => void startListening()
  }, [startListening])

  /** After an answer: in hands-free mode she listens again. */
  const afterReply = useCallback(() => {
    if (settingsRef.current?.voiceMode && voiceRef.current === 'idle') setTimeout(() => startListeningRef.current(), 450)
  }, [])

  const toggleListening = useCallback(() => {
    if (voiceRef.current === 'listening') stopListening()
    else if (voiceRef.current === 'speaking') stopSpeaking()
    else if (voiceRef.current === 'idle') void startListening()
  }, [startListening, stopListening, stopSpeaking])

  // ---------------------------------------------------------------- wake word ("Lumi, ...")
  const [wakeOn, setWakeOn] = useState(false)
  useEffect(() => {
    if (!wakeOn) return
    let alive = true
    let listener: WakeListener | null = null
    let checking = false

    const onUtterance = async (wav: string): Promise<void> => {
      if (checking || !alive) return
      checking = true
      try {
        const r = await window.lumo.aiWakeCheck(wav)
        const brain = brainRef.current
        if (!alive || !r.wake || !brain || voiceRef.current !== 'idle') return
        brain.touch()
        brain.setMood('surprised', 700)
        chime()
        if (r.hasCommand) {
          // she was called and asked in one breath: the same recording is the request
          setVoice('transcribing')
          const sent = await window.lumo.aiVoiceSend(wav)
          setVoice('idle')
          if (!sent.ok) emitErrorToChat(sent.error ?? 'Não consegui entender o áudio.')
          else if (sent.text) awaitingReply.current = true
        } else {
          setTimeout(() => startListeningRef.current(), 250)
        }
      } finally {
        checking = false
      }
    }

    void (async () => {
      const status = await window.lumo.aiWakePrepare()
      if (!alive || status.state === 'error') {
        if (alive && status.message) emitErrorToChat(status.message)
        return
      }
      listener = new WakeListener({
        shouldListen: () =>
          voiceRef.current === 'idle' &&
          performance.now() > quietUntil.current &&
          !checking &&
          settingsRef.current?.voiceMode !== true,
        onUtterance: (wav) => void onUtterance(wav),
        onError: (message) => emitErrorToChat(message)
      })
      if (!(await listener.start())) {
        listener = null
        return
      }
      if (!alive) listener?.stop()
    })()

    return () => {
      alive = false
      listener?.stop()
    }
  }, [wakeOn, setVoice])

  // ---------------------------------------------------------------- setup: brain and loop
  useEffect(() => {
    const brain = new Brain({
      fx: emitFx,
      home: (x, y) => {
        try {
          localStorage.setItem('lumi-home', JSON.stringify({ x, y }))
        } catch {
          // private storage: her corner is forgotten next time
        }
      }
    })
    try {
      const saved = JSON.parse(localStorage.getItem('lumi-home') ?? 'null') as { x: number; y: number | null } | null
      if (saved && typeof saved.x === 'number') brain.setHome(saved.x, typeof saved.y === 'number' ? saved.y : null)
    } catch {
      // no saved corner: the default one
    }
    brainRef.current = brain
    let raf = 0
    let last = performance.now()
    let stageW = 800
    const frame = (now: number): void => {
      const dt = (now - last) / 1000
      last = now
      const k = BASE_K * scaleRef.current
      brain.setBody(SVG_H * k)
      const targets = brain.update(dt)
      rigRef.current?.step(Math.min(dt, 0.05), targets)

      if (stageReadyRef.current) {
        const footDrop = (SVG_H - GROUND_Y) * k + 2
        const svgW = SVG_W * k
        const svgH = SVG_H * k
        const bubbleEl = bubbleRef.current
        const bw = bubbleActiveRef.current && bubbleEl ? BUBBLE_W : 0
        const pad = offerRef.current ? OFFER_PAD : 0
        const w = Math.round(Math.max(svgW + 2 * FX_SIDE + 2 * pad, bw + 16))
        const bubbleH = bubbleActiveRef.current && bubbleEl ? bubbleEl.offsetHeight + BUBBLE_GAP : 0
        const h = Math.round(svgH + FX_TOP + bubbleH)
        const fy = brain.y + footDrop
        const key = `${Math.round(brain.x)},${Math.round(fy)},${w},${h}`
        if (key !== lastRectRef.current) {
          lastRectRef.current = key
          window.lumo.setMascotRect({ fx: Math.round(brain.x), fy: Math.round(fy), w, h })
        }
        // keep the bubble inside the page area even when she stands at the edge
        if (bubbleEl) {
          const left = brain.x - w / 2 + (w - BUBBLE_W) / 2
          let shift = 0
          if (left < 6) shift = 6 - left
          else if (left + BUBBLE_W > stageW - 6) shift = stageW - 6 - (left + BUBBLE_W)
          bubbleEl.style.transform = `translateX(${Math.round(shift)}px)`
          bubbleEl.style.bottom = `${Math.round(svgH - 34 * k * 0.9)}px`
          bubbleEl.style.setProperty('--tail-x', `${Math.round(-shift)}px`)
        }
      }
      raf = requestAnimationFrame(frame)
    }
    const offStage = window.lumo.onMascotStage((stage) => {
      brain.setStage(stage.width, stage.height, stage.top)
      stageW = stage.width
      stageReadyRef.current = true
    })
    raf = requestAnimationFrame(frame)
    window.lumo.mascotReady()
    return () => {
      cancelAnimationFrame(raf)
      offStage()
      brainRef.current = null
    }
  }, [emitFx])

  // the drawing: one per character, each with its own rig
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const rig = new Rig(svg, persona)
    rig.snap(REST)
    rigRef.current = rig
    return () => {
      if (rigRef.current === rig) rigRef.current = null
    }
  }, [persona])

  useEffect(() => {
    bubbleActiveRef.current = bubble !== null || (voiceUi !== 'idle' && voiceUi !== 'speaking' && !chatOpenRef.current)
  }, [bubble, voiceUi])

  // ---------------------------------------------------------------- settings & commands
  useEffect(() => {
    let firstSettings = true
    const apply = (s: { assistant: AssistantSettings }): void => {
      const prev = settingsRef.current
      settingsRef.current = s.assistant
      scaleRef.current = s.assistant.scale
      setScale(s.assistant.scale)
      brainRef.current?.setRoam(s.assistant.roam)
      setWakeOn(s.assistant.enabled && s.assistant.wakeWord)
      if (personaRef.current !== s.assistant.persona) {
        const switching = !firstSettings
        personaRef.current = s.assistant.persona
        setPersona(s.assistant.persona)
        if (switching) {
          stopSpeaking()
          const info = PERSONAS[s.assistant.persona]
          setTimeout(() => {
            brainRef.current?.gesture('spin')
            say(`Troca feita! Agora quem fala é ${info.name}.`, 4500)
          }, 150)
        }
      }
      if (s.assistant.voiceMode && !prev?.voiceMode) {
        emptyRounds.current = 0
        if (!firstSettings) void startListening()
      } else if (!s.assistant.voiceMode && prev?.voiceMode) {
        stopListening()
      }
      if (!s.assistant.voice && prev?.voice) stopSpeaking()
      firstSettings = false
    }
    void window.lumo.getSettings().then(apply)
    const offSettings = window.lumo.onSettingsChanged(apply)

    const offChat = window.lumo.onMascotChatState((open) => {
      chatOpenRef.current = open
      brainRef.current?.setChatOpen(open)
      if (open) {
        setBubble(null)
        brainRef.current?.setMood('happy', 1800)
      }
    })

    const offCommand = window.lumo.onMascotCommand((cmd: MascotCommand) => {
      const brain = brainRef.current
      if (!brain) return
      if (cmd.kind === 'mood') brain.setMood(cmd.mood, cmd.ms ?? 6000)
      else if (cmd.kind === 'gesture') brain.gesture(cmd.gesture)
      else if (cmd.kind === 'move') brain.moveTo(cmd.to)
      else if (cmd.kind === 'say') {
        say(cmd.text)
        if (cmd.speak) {
          brain.setMood('happy', 2500)
          void speak(cmd.text)
        }
      } else if (cmd.kind === 'fly') brain.flyToFraction(cmd.x, cmd.y, cmd.hold ?? 4000)
      else if (cmd.kind === 'point') brain.pointAt(cmd.x, cmd.y, cmd.w, cmd.h, cmd.hold ?? 5000, cmd.guard === true)
      else if (cmd.kind === 'home') brain.goHome()
      else if (cmd.kind === 'wake') brain.wake()
      else if (cmd.kind === 'voice') {
        if (cmd.action === 'toggle') toggleListening()
        else if (cmd.action === 'start') void startListening()
        else if (cmd.action === 'stop') stopListening()
        else if (cmd.action === 'stop-speaking') stopSpeaking()
      }
    })

    let lastReaction = 0
    const offBrowser = window.lumo.onMascotBrowserEvent((event: MascotBrowserEvent) => {
      const brain = brainRef.current
      if (!brain || brain.held) return
      const now = Date.now()
      if (event === 'download-done') {
        brain.gesture('cheer')
        say('Terminou de baixar!', 4200)
        return
      }
      if (event === 'update-ready') {
        say('Tem uma versão nova do Lumo pronta. Clique em "Atualizar" lá em cima!', 6000)
        return
      }
      if (now - lastReaction < 7000 || chatOpenRef.current) return
      lastReaction = now
      if (event === 'tab-opened') brain.gesture('peek')
      else if (event === 'tab-closed' && Math.random() < 0.5) brain.setMood('surprised', 700)
    })

    const offAi = window.lumo.onAiEvent((event: AiEvent) => {
      const brain = brainRef.current
      if (!brain) return
      if (event.type === 'offer') {
        offerRef.current = !!event.options?.length
        setOffer(event.options?.length ? event.options : null)
        brain.setOffering(offerRef.current)
        return
      }
      if (event.type === 'busy') {
        brain.setActivity(event.busy ? 'think' : null)
        if (event.busy) {
          brain.setMood('thinking', 60000)
          stopSpeaking()
        } else if (brain.speaking === false) brain.setMood('neutral')
      } else if (event.type === 'tool-start') {
        brain.setActivity(event.anim)
      } else if (event.type === 'tool-end') {
        brain.setActivity('think')
      } else if (event.type === 'message') {
        brain.setActivity(null)
        const { text, tags } = parseEmoteTags(event.message.text)
        brain.touch()
        brain.setMood('neutral')
        let first = true
        for (const tag of tags) {
          const emote = EMOTE_TAGS[tag]
          if (emote.mood) brain.setMood(emote.mood, first ? 7000 : 3500)
          if (emote.gesture && first) brain.gesture(emote.gesture)
          first = false
        }
        say(text)
        awaitingReply.current = false
        void speak(text).then(afterReply)
      } else if (event.type === 'error') {
        brain.setActivity(null)
        brain.setMood('sad', 5000)
        say(event.message, 7000)
        awaitingReply.current = false
        if (event.code !== 'auth' && event.code !== 'no-key') afterReply()
      } else if (event.type === 'confirm') {
        brain.setActivity(null)
        brain.setMood('shy', 8000)
        if (!chatOpenRef.current) window.lumo.toggleAssistant()
      }
    })

    return () => {
      offSettings()
      offChat()
      offCommand()
      offBrowser()
      offAi()
    }
  }, [say, speak, afterReply, startListening, stopListening, stopSpeaking, toggleListening])

  // ---------------------------------------------------------------- first hello, random remarks
  useEffect(() => {
    let greeted = false
    try {
      greeted = localStorage.getItem('lumi-greeted') === '1'
      localStorage.setItem('lumi-greeted', '1')
    } catch {
      // private storage: she just greets every time
    }
    const hello = setTimeout(() => {
      const brain = brainRef.current
      if (!brain || chatOpenRef.current) return
      brain.gesture('wave')
      const info = PERSONAS[personaRef.current]
      say(greeted ? `Oi de novo! ${info.name} está por aqui.` : info.greeting, 7000)
    }, 1800)
    const quip = setInterval(() => {
      const brain = brainRef.current
      if (!brain || chatOpenRef.current || brain.isSleeping || brain.held || bubbleActiveRef.current) return
      if (settingsRef.current?.roam && !settingsRef.current?.curiosity && Math.random() < 0.22) {
        const quips = PERSONAS[personaRef.current].quips
        say(quips[Math.floor(Math.random() * quips.length)], 5200)
      }
    }, 70_000)
    return () => {
      clearTimeout(hello)
      clearInterval(quip)
    }
  }, [say])

  // ---------------------------------------------------------------- pointer: click, double-click, drag
  const gesture = useRef<{
    startScreenX: number
    startScreenY: number
    startX: number
    startY: number
    dragging: boolean
    lastT: number
    lastClick: number
    timer: ReturnType<typeof setTimeout> | null
    pokes: number[]
  }>({ startScreenX: 0, startScreenY: 0, startX: 0, startY: 0, dragging: false, lastT: 0, lastClick: 0, timer: null, pokes: [] })

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const brain = brainRef.current
    if (!brain) return
    const g = gesture.current
    g.startScreenX = e.screenX
    g.startScreenY = e.screenY
    g.startX = brain.x
    g.startY = brain.y
    g.dragging = false
    g.lastT = performance.now()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const brain = brainRef.current
    if (!brain) return
    const g = gesture.current
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
    if (g.dragging) {
      g.dragging = false
      brain.release()
      return
    }
    // touching her while she talks or listens only stops that
    if (voiceRef.current === 'speaking' || voiceRef.current === 'listening') {
      toggleListening()
      return
    }
    // a click: one opens the chat (after a beat, in case it becomes a double click), two tickle her
    const now = performance.now()
    brain.touch()
    g.pokes = g.pokes.filter((t) => now - t < 1600)
    g.pokes.push(now)
    if (g.timer && now - g.lastClick < CLICK_DELAY_MS) {
      clearTimeout(g.timer)
      g.timer = null
      if (g.pokes.length >= 4) {
        brain.setMood('angry', 3500)
        say(personaRef.current === 'girl' ? 'Ei! Chega de cutucar! Hmpf.' : 'Já chega. Para de me cutucar.', 3500)
        brain.gesture('jump')
      } else {
        brain.setMood('wink', 1600)
        brain.gesture('spin')
        say(personaRef.current === 'girl' ? 'Hihi, cócegas!' : 'T-tsc. Não faz isso.', 1800)
      }
    } else {
      g.timer = setTimeout(() => {
        g.timer = null
        window.lumo.toggleAssistant()
      }, CLICK_DELAY_MS)
    }
    g.lastClick = now
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const brain = brainRef.current
    if (!brain) return
    const rect = bodyRef.current?.getBoundingClientRect()
    if (rect) {
      const k = BASE_K * scaleRef.current
      brain.setPointer({ x: brain.x + (e.clientX - (rect.left + rect.width / 2)), y: brain.y + (e.clientY - (rect.top + GROUND_Y * k)) })
    }
    const g = gesture.current
    if ((e.buttons & 1) === 0) {
      if (g.dragging) onPointerUp(e)
      return
    }
    const dx = e.screenX - g.startScreenX
    const dy = e.screenY - g.startScreenY
    if (!g.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      g.dragging = true
      brain.grab()
      setBubble(null)
    }
    if (g.dragging) {
      const now = performance.now()
      brain.drag(g.startX + dx, g.startY + dy, (now - g.lastT) / 1000)
      g.lastT = now
    }
  }

  const k = BASE_K * scale
  const svgW = SVG_W * k
  const svgH = SVG_H * k
  const showVoiceBubble = (voiceUi === 'listening' || voiceUi === 'transcribing') && !chatOpenRef.current

  return (
    <div className={`lm-root ${voiceUi === 'listening' ? 'lm-root--listening' : ''}`}>
      {showVoiceBubble ? (
        <div ref={bubbleRef} className="lm-bubble lm-bubble--listening" style={{ width: 180 }} onClick={toggleListening}>
          {voiceUi === 'listening' ? (
            <>
              <span className="lm-meter" ref={meterRef}>
                <i />
                <i />
                <i />
              </span>
              Ouvindo…
            </>
          ) : (
            'Entendendo…'
          )}
        </div>
      ) : (
        bubble && (
          <div
            key={bubble.id}
            ref={bubbleRef}
            className="lm-bubble"
            style={{ width: BUBBLE_W }}
            onClick={() => {
              setBubble(null)
              window.lumo.toggleAssistant()
            }}
            title="Clique para conversar"
          >
            {bubble.text}
          </div>
        )
      )}
      <div className="lm-fxlayer" style={{ bottom: svgH * 0.5, width: svgW }}>
        {fx.map((f) => (
          <span key={f.id} className={`lm-fx lm-fx--${f.kind}`} style={{ left: `calc(50% + ${f.dx}px)` }} />
        ))}
      </div>
      <div className="lm-listening-ring" />
      <div
        ref={bodyRef}
        className="lm-body"
        style={{ width: svgW, height: svgH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => brainRef.current?.setPointer(null)}
        onContextMenu={(e) => {
          e.preventDefault()
          window.lumo.showMascotMenu()
        }}
      >
        <MascotSvg key={persona} ref={svgRef} variant={persona} />
      </div>
      {offer?.slice(0, 2).map((o, i) => (
        <button
          key={`${o.host}-${i}`}
          className={`lm-offer lm-offer--${i === 0 ? 'left' : 'right'}`}
          style={{ bottom: svgH * 0.3, [i === 0 ? 'right' : 'left']: `calc(50% + ${svgW * 0.5 - 16}px)` }}
          title={`${o.title} (${o.host})`}
          onClick={() => {
            setOffer(null)
            offerRef.current = false
            brainRef.current?.setOffering(false)
            void window.lumo.aiChoose(i)
          }}
        >
          <span className="lm-offer__icon">
            {o.favicon ? <img src={o.favicon} alt="" draggable={false} /> : <b>{(o.host[0] ?? '?').toUpperCase()}</b>}
          </span>
          <span className="lm-offer__name">{o.title.length > 14 ? `${o.title.slice(0, 13)}…` : o.title}</span>
          <span className="lm-offer__host">{o.host.replace(/^www\./, '')}</span>
        </button>
      ))}
    </div>
  )
}
