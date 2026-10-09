import type { Gesture, Mood, ToolAnim } from '@shared/ai'
import { REST, type Targets } from './rig'

export type FxKind = 'zzz' | 'heart' | 'note' | 'bang' | 'ask' | 'dots' | 'spark' | 'dust' | 'gear' | 'star' | 'ring'

type Motion =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'sleep'
  | 'wave'
  | 'dance'
  | 'cheer'
  | 'jump'
  | 'spin'
  | 'stretch'
  | 'peek'

const GRAVITY = 2300
const MARGIN_X = 46
const GROUND_PAD = 8
const STRIDE_PX = 74
const SLEEP_AFTER_S = 110
const RUN_SPEED = 190

const DURATIONS: Partial<Record<Motion, number>> = {
  wave: 2.0,
  dance: 4.2,
  cheer: 1.5,
  spin: 0.95,
  stretch: 1.9,
  peek: 1.5,
  jump: 0.9
}

const sin = Math.sin
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo)

export interface BrainEvents {
  fx(kind: FxKind): void
  /** She was dropped somewhere new: that is her corner now (fractions of the stage; y null = on the ground). */
  home(x: number, y: number | null): void
}

/** Lumi's body and mind: where she is, what she is doing, how she feels. `update` turns that into a pose every frame. */
export class Brain {
  // world (stage pixels; x is the middle of her feet, y the ground line under them)
  x = 200
  y = 0
  vx = 0
  vy = 0
  face: 1 | -1 = -1
  stageW = 800
  stageH = 600
  stageTop = 100
  /** Height of the drawing in pixels, so she is never dragged above the window. */
  bodyPx = 170
  held = false

  // behavior
  private motion: Motion = 'idle'
  private motionT = 0
  private motionLen = 0
  private t = 0
  private idleT = 0
  private nextAction = 3
  private walkTo: number | null = null
  private walkSpeed = 80
  private walkPhase = 0
  private walkBlend = 0
  private afterWalk: Motion | null = null
  private sitT = 0
  private landT = 0
  private prepT = 0
  private pendingJump = 0
  private sleeping = false
  private lastInteraction = 0

  // her corner and flying
  private homeFrac: { x: number; y: number | null } = { x: -1, y: null }
  private homeX = 200
  private homeY = 0
  private floating = false
  private flyGoal: { x: number; y: number } | null = null
  private flyHoldMs = 0
  private flyHold = 0
  private flyReturn = false
  private pointTo: { x: number; y: number } | null = null
  private pointGuard = false
  private offering = false
  private fvx = 0
  private fvy = 0
  private trailT = 0

  private mood: Mood = 'neutral'
  private moodUntil = 0
  private activity: ToolAnim | null = null
  private activityT = 0
  private talkUntil = 0
  private chatOpen = false
  private roam = true

  private blinkAt = 2
  private blinkT = -1
  private lookGoal = { x: 0, y: 0 }
  private lookAt = 3
  private pointer: { x: number; y: number } | null = null
  private twitchAt = 4
  private twitchSide = 0
  private twitchT = -1
  private dragVX = 0
  private ringAt = 0
  /** Loudness of the voice being played (0-1), to move the mouth with the real audio; null = invent it. */
  private mouthLevel: number | null = null
  private listening = false

  constructor(private events: BrainEvents) {}

  get groundY(): number {
    return this.stageH - GROUND_PAD
  }

  get isSleeping(): boolean {
    return this.sleeping
  }

  get isMoving(): boolean {
    return this.motion === 'walk' || this.flyGoal !== null
  }

  /** Off on an errand (flying somewhere, or staying there for a while). */
  get away(): boolean {
    return this.flyGoal !== null || this.flyHold > 0
  }

  get speaking(): boolean {
    return this.t < this.talkUntil
  }

  // ------------------------------------------------------------ world

  setStage(width: number, height: number, top: number): void {
    const firstTime = this.stageH === 600 && this.y === 0
    this.stageW = width
    this.stageH = height
    this.stageTop = top
    this.applyHome(firstTime)
    this.x = clamp(this.x, MARGIN_X, Math.max(MARGIN_X, width - MARGIN_X))
    this.y = clamp(this.y, this.minY(), this.groundY)
    if (this.walkTo !== null) this.walkTo = clamp(this.walkTo, MARGIN_X, Math.max(MARGIN_X, width - MARGIN_X))
  }

  setBody(px: number): void {
    this.bodyPx = px
  }

  /** Where her corner is (fractions of the stage); the default is the bottom-right. */
  setHome(x: number, y: number | null): void {
    this.homeFrac = { x, y }
    this.applyHome(false)
  }

  private applyHome(force: boolean): void {
    this.homeX = this.homeFrac.x < 0 ? Math.max(MARGIN_X, this.stageW - 130) : clamp(this.homeFrac.x * this.stageW, MARGIN_X, Math.max(MARGIN_X, this.stageW - MARGIN_X))
    this.homeY = this.homeFrac.y === null ? this.groundY : clamp(this.homeFrac.y * this.stageH, this.minY(), this.groundY)
    if (force || (!this.away && !this.held)) {
      this.x = this.homeX
      this.y = this.homeY
      this.vy = 0
      this.floating = this.homeY < this.groundY - 6
    }
  }

  setRoam(roam: boolean): void {
    this.roam = roam
    if (!roam && this.motion === 'walk') this.stopWalking()
  }

  /** The highest her feet may be: her head must stay inside the window. */
  private minY(): number {
    return Math.min(this.groundY, this.bodyPx - this.stageTop + 12)
  }

  setPointer(p: { x: number; y: number } | null): void {
    this.pointer = p
  }

  // ------------------------------------------------------------ interaction

  grab(): void {
    this.held = true
    this.touch()
    this.stopWalking()
    this.flyGoal = null
    this.flyHold = 0
    this.pointTo = null
    this.floating = false
    this.motion = 'idle'
    this.sleeping = false
    this.vx = 0
    this.vy = 0
  }

  drag(x: number, y: number, dt: number): void {
    const nx = clamp(x, MARGIN_X / 2, this.stageW - MARGIN_X / 2)
    const ny = clamp(y, this.minY(), this.groundY + 6)
    if (dt > 0) this.dragVX += ((nx - this.x) / dt - this.dragVX) * 0.35
    if (Math.abs(nx - this.x) > 1) this.face = nx > this.x ? 1 : -1
    this.x = nx
    this.y = ny
  }

  release(): void {
    this.held = false
    this.vx = 0
    this.vy = 0
    this.setMood('surprised', 900)
    this.dragVX = 0
    // She can fly: wherever she is let go, she stays (floating if it is in the air), and that becomes her corner.
    const onGround = this.y >= this.groundY - 6
    this.floating = !onGround
    if (onGround) this.y = this.groundY
    this.homeFrac = { x: this.x / this.stageW, y: onGround ? null : this.y / this.stageH }
    this.homeX = this.x
    this.homeY = this.y
    this.events.home(this.homeFrac.x, this.homeFrac.y)
  }

  touch(): void {
    this.lastInteraction = this.t
    this.idleT = 0
    if (this.sleeping) this.wake()
  }

  wake(): void {
    if (!this.sleeping && this.motion !== 'sit') return
    this.sleeping = false
    this.motion = 'idle'
    this.motionT = 0
    this.setMood('surprised', 700)
    this.events.fx('bang')
  }

  setChatOpen(open: boolean): void {
    this.chatOpen = open
    this.touch()
    if (open) {
      this.stopWalking()
      if (this.motion === 'sit' || this.motion === 'sleep') this.motion = 'idle'
      this.sleeping = false
      this.face = this.x < this.stageW / 2 ? 1 : -1
    }
  }

  // ------------------------------------------------------------ commands

  setMood(mood: Mood, ms = 6000): void {
    if (this.mood !== mood) {
      if (mood === 'love') this.events.fx('heart')
      if (mood === 'surprised') this.events.fx('bang')
      if (mood === 'thinking') this.events.fx('dots')
      if (mood === 'excited') this.events.fx('spark')
    }
    this.mood = mood
    this.moodUntil = mood === 'neutral' ? 0 : this.t + ms / 1000
  }

  talk(ms: number): void {
    this.talkUntil = this.t + ms / 1000
  }

  stopTalking(): void {
    this.talkUntil = 0
    this.mouthLevel = null
  }

  setMouthLevel(level: number | null): void {
    this.mouthLevel = level
  }

  /** The microphone is open: ears up, head tilted toward whoever speaks. */
  setListening(on: boolean): void {
    this.listening = on
    if (on) {
      this.touch()
      this.stopWalking()
      if (this.motion === 'sit' || this.motion === 'sleep') this.motion = 'idle'
    }
  }

  setActivity(anim: ToolAnim | null): void {
    this.activity = anim
    this.activityT = 0
    if (anim) {
      this.touch()
      this.stopWalking()
      if (this.motion === 'sit' || this.motion === 'sleep') this.motion = 'idle'
    }
  }

  gesture(g: Gesture): void {
    this.touch()
    this.stopWalking()
    this.sleeping = false
    switch (g) {
      case 'sit':
        this.motion = 'sit'
        this.motionT = 0
        this.sitT = rand(7, 14)
        break
      case 'sleep':
        this.motion = 'sleep'
        this.motionT = 0
        this.sleeping = true
        this.setMood('sleepy', 600_000)
        break
      case 'jump':
        this.startJump(560)
        break
      case 'cheer':
        this.begin('cheer')
        this.startJump(520)
        this.setMood('excited', 2500)
        break
      case 'dance':
        this.begin('dance')
        this.setMood('excited', 4400)
        break
      case 'wave':
        this.begin('wave')
        this.setMood('happy', 2300)
        break
      case 'spin':
        this.begin('spin')
        break
      case 'stretch':
        this.begin('stretch')
        break
      case 'peek':
        this.begin('peek')
        break
    }
  }

  moveTo(to: 'left' | 'right' | 'center'): void {
    const x = to === 'left' ? MARGIN_X + 20 : to === 'right' ? this.stageW - MARGIN_X - 20 : this.stageW / 2
    this.flyTo(x, this.groundY, 6000)
  }

  /** Flies to a spot (feet position, stage pixels). With `holdMs` she stays there that long and then goes home. */
  flyTo(x: number, y: number, holdMs = 0, back = true): void {
    this.touch()
    this.stopWalking()
    this.sleeping = false
    if (this.motion === 'sit' || this.motion === 'sleep') this.motion = 'idle'
    this.flyGoal = { x: clamp(x, MARGIN_X / 2, this.stageW - MARGIN_X / 2), y: clamp(y, this.minY(), this.groundY) }
    this.flyHoldMs = holdMs
    this.flyReturn = back && holdMs > 0
    this.flyHold = 0
    this.pointTo = null
    this.pointGuard = false
    this.floating = true
    this.prepT = 0
    this.vy = 0
    this.events.fx('spark')
  }

  /** Flies to a place given as fractions of the page area (the middle of her body goes there). */
  flyToFraction(fx: number, fy: number, holdMs: number): void {
    this.flyTo(fx * this.stageW, fy * this.stageH + this.bodyPx * 0.5, holdMs)
  }

  /** Flies next to something on the page and points at it (stage pixels: its middle and size). */
  pointAt(x: number, y: number, w: number, h: number, holdMs: number, guard = false): void {
    const room = this.bodyPx * 0.45 + 44
    const preferLeft = x > this.stageW / 2
    let standX = preferLeft ? x - w / 2 - room : x + w / 2 + room
    if (standX < MARGIN_X || standX > this.stageW - MARGIN_X) standX = preferLeft ? x + w / 2 + room : x - w / 2 - room
    this.flyTo(standX, y + this.bodyPx * 0.5, holdMs)
    this.pointTo = { x, y }
    this.pointGuard = guard
    this.face = x >= standX ? 1 : -1
    if (guard) this.setMood('angry', holdMs + 1200)
  }

  /** She holds both hands out, each with something to choose from. */
  setOffering(on: boolean): void {
    this.offering = on
    if (on) {
      this.touch()
      this.setMood('thinking', 120_000)
    } else if (this.mood === 'thinking' && this.activity === null) this.setMood('neutral')
  }

  goHome(): void {
    this.flyTo(this.homeX, this.homeY, 0, false)
  }

  private begin(m: Motion): void {
    this.motion = m
    this.motionT = 0
    this.motionLen = DURATIONS[m] ?? 0
  }

  private startJump(power: number): void {
    if (this.floating) return
    this.prepT = 0.13
    this.pendingJump = power
  }

  private startWalk(x: number, speed: number, then: Motion | null = null): void {
    this.walkTo = clamp(x, MARGIN_X, Math.max(MARGIN_X, this.stageW - MARGIN_X))
    this.walkSpeed = speed
    this.afterWalk = then
    this.motion = 'walk'
    this.motionT = 0
    this.sleeping = false
  }

  private stopWalking(): void {
    this.walkTo = null
    this.afterWalk = null
    if (this.motion === 'walk') this.motion = 'idle'
  }

  // ------------------------------------------------------------ simulation

  private onGround(): boolean {
    return !this.floating && this.y >= this.groundY - 0.5 && this.vy === 0
  }

  private simulate(dt: number): void {
    if (this.held) return
    if (this.prepT > 0) {
      this.prepT -= dt
      if (this.prepT <= 0) {
        this.vy = -this.pendingJump
        this.pendingJump = 0
      }
    }
    if (!this.floating && (this.y < this.groundY - 0.5 || this.vy !== 0)) {
      this.vy += GRAVITY * dt
      this.y += this.vy * dt
      if (this.y >= this.groundY) {
        const impact = this.vy
        this.y = this.groundY
        this.vy = 0
        if (impact > 300) {
          this.landT = 0.16
          this.events.fx('dust')
        }
      }
    }
    if (this.flyGoal) {
      const g = this.flyGoal
      const fdx = g.x - this.x
      const fdy = g.y - this.y
      const dist = Math.hypot(fdx, fdy)
      if (dist < 4) {
        this.x = g.x
        this.y = g.y
        this.flyGoal = null
        this.fvx = 0
        this.fvy = 0
        if (g.y >= this.groundY - 2) {
          this.y = this.groundY
          this.floating = false
          this.vy = 0
          this.events.fx('dust')
        }
        if (this.pointTo) this.face = this.pointTo.x >= this.x ? 1 : -1
        if (this.flyHoldMs > 0) this.flyHold = this.flyHoldMs / 1000
        else this.pointTo = null
      } else {
        const speed = clamp(dist * 6.5, 150, 1900)
        const step = Math.min(dist, speed * dt)
        this.x += (fdx / dist) * step
        this.y += (fdy / dist) * step
        this.fvx = (fdx / dist) * speed
        this.fvy = (fdy / dist) * speed
        if (!this.pointTo && Math.abs(this.fvx) > 40) this.face = this.fvx > 0 ? 1 : -1
        this.trailT -= dt
        if (speed > 500 && this.trailT <= 0) {
          this.trailT = 0.16
          this.events.fx('spark')
        }
      }
    }
    if (this.motion === 'walk' && this.walkTo !== null) {
      const dx = this.walkTo - this.x
      const step = this.walkSpeed * dt
      if (Math.abs(dx) <= step) {
        this.x = this.walkTo
        this.walkTo = null
        const next = this.afterWalk
        this.afterWalk = null
        if (next === 'sit') {
          this.motion = 'sit'
          this.sitT = rand(6, 12)
        } else this.motion = 'idle'
        this.motionT = 0
      } else {
        this.face = dx > 0 ? 1 : -1
        this.x += Math.sign(dx) * step
        this.walkPhase += (this.walkSpeed / STRIDE_PX) * dt * Math.PI * 2
      }
    }
    this.x = clamp(this.x, MARGIN_X / 2, this.stageW - MARGIN_X / 2)
  }

  private think(dt: number): void {
    // timed things
    if (this.mood !== 'neutral' && this.moodUntil > 0 && this.t > this.moodUntil && !this.sleeping) this.mood = 'neutral'
    if (this.motionLen > 0 && this.motionT > this.motionLen && this.motion !== 'walk') {
      this.motion = 'idle'
      this.motionLen = 0
    }
    if (this.motion === 'sit' && this.sitT > 0) {
      this.sitT -= dt
      if (this.sitT <= 0 && !this.chatOpen) this.motion = 'idle'
    }

    if (this.flyHold > 0) {
      this.flyHold -= dt
      if (this.flyHold <= 0) {
        this.flyHold = 0
        if (this.flyReturn) this.goHome()
        else this.pointTo = null
      }
    }

    const busy = this.activity !== null || this.chatOpen || this.held
    const since = this.t - this.lastInteraction
    if (this.motion === 'idle') this.idleT += dt
    else if (this.motion !== 'sit') this.idleT = 0

    // nap when nobody has talked to her for a while
    if (!busy && this.roam && !this.sleeping && since > SLEEP_AFTER_S && this.onGround() && this.motion === 'idle') {
      this.motion = 'sleep'
      this.motionT = 0
      this.sleeping = true
      this.setMood('sleepy', 600_000)
      return
    }

    // She stays in her corner: small things to do there, no wandering about.
    const settled = this.onGround() || (this.floating && this.flyGoal === null)
    if (!busy && this.roam && this.motion === 'idle' && settled && this.flyHold === 0 && this.idleT > this.nextAction) {
      this.idleT = 0
      this.nextAction = rand(5, 12)
      const r = Math.random()
      if (r < 0.2 && this.onGround()) {
        this.motion = 'sit'
        this.sitT = rand(7, 14)
      } else if (r < 0.5) {
        this.lookGoal = { x: rand(-1, 1), y: rand(-0.6, 0.5) }
        this.lookAt = this.t + rand(1.5, 3)
      } else if (r < 0.64) this.begin('wave')
      else if (r < 0.78) this.begin('stretch')
      else if (r < 0.9) this.begin('spin')
      else this.begin('dance')
    }

    // blinking and looking about
    if (this.blinkT < 0 && this.t > this.blinkAt) {
      this.blinkT = 0
      this.blinkAt = this.t + rand(2, 5.5)
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt
      if (this.blinkT > 0.16) this.blinkT = -1
    }
    if (this.t > this.lookAt) {
      this.lookGoal = Math.random() < 0.4 ? { x: 0, y: 0 } : { x: rand(-0.9, 0.9), y: rand(-0.4, 0.4) }
      this.lookAt = this.t + rand(1.2, 3.8)
    }
    if (this.twitchT < 0 && this.t > this.twitchAt) {
      this.twitchT = 0
      this.twitchSide = Math.random() < 0.5 ? -1 : 1
      this.twitchAt = this.t + rand(3, 8)
    }
    if (this.twitchT >= 0) {
      this.twitchT += dt
      if (this.twitchT > 0.22) this.twitchT = -1
    }

    // sleeping: breathe out little Z's
    if (this.sleeping && Math.floor(this.t * 0.6) !== Math.floor((this.t - dt) * 0.6)) this.events.fx('zzz')
    if (this.motion === 'dance' && Math.floor(this.t * 2.2) !== Math.floor((this.t - dt) * 2.2)) this.events.fx('note')
    if (this.mood === 'love' && Math.floor(this.t * 1.2) !== Math.floor((this.t - dt) * 1.2)) this.events.fx('heart')
    if (this.activity === 'click' && Math.floor(this.t * 1.4) !== Math.floor((this.t - dt) * 1.4)) this.events.fx('ring')
    if (this.activity === 'settings' && Math.floor(this.t * 1.0) !== Math.floor((this.t - dt) * 1.0)) this.events.fx('gear')
    if (this.activity === 'bookmark' && Math.floor(this.t * 1.0) !== Math.floor((this.t - dt) * 1.0)) this.events.fx('star')
  }

  // ------------------------------------------------------------ pose

  update(dt: number): Targets {
    dt = Math.min(dt, 0.05)
    this.t += dt
    this.motionT += dt
    this.activityT += dt
    if (this.landT > 0) this.landT -= dt
    this.think(dt)
    this.simulate(dt)
    this.walkBlend += ((this.motion === 'walk' && this.onGround() ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 12)

    const p: Targets = { ...REST }
    this.poseMood(p)
    this.poseMotion(p)
    this.poseActivity(p)
    this.posePoint(p)
    this.poseOffer(p)
    this.poseTalk(p)
    this.poseEyes(p)
    this.poseHair(p)
    return p
  }

  private poseMood(p: Targets): void {
    switch (this.mood) {
      case 'happy':
        p.blush = 0.35
        p.glow = 0.9
        p.earL = p.earR = 10
        p.mOpen = 0.9
        p.mSmile = 0.1
        p.openAmt = 0.3
        break
      case 'excited':
        p.happyL = p.happyR = 1
        p.mSmile = 0
        p.mOpen = 1
        p.openAmt = 0.85
        p.blush = 0.5
        p.glow = 1.3
        p.earL = p.earR = 15
        break
      case 'sad':
        p.eyeOpen = 0.85
        p.browL = p.browR = 16
        p.browY = 2
        p.mSmile = 0
        p.mFrown = 1
        p.tear = 0.9
        p.earL = p.earR = -24
        p.glow = 0.15
        p.blush = 0.05
        p.headY = 3
        p.tail1 = 14
        p.tail2 = 6
        p.tail3 = 4
        break
      case 'surprised':
        p.eyeOpen = 1.12
        p.mSmile = 0
        p.mO = 1
        p.browY = -4
        p.earL = p.earR = 18
        p.glow = 1
        break
      case 'thinking':
        p.mSmile = 0.1
        p.mFlat = 0.9
        p.browL = 10
        p.browR = -6
        p.lookX = 0.7
        p.lookY = -0.7
        p.headRot = 7
        break
      case 'shy':
        p.blush = 1
        p.happyL = p.happyR = 0.45
        p.lookX = -0.5
        p.lookY = 0.8
        p.headRot = -7
        p.earL = p.earR = -4
        break
      case 'sleepy':
        p.eyeOpen = 0.32
        p.mSmile = 0.2
        p.mOpen = 0.6
        p.openAmt = 0.25
        p.earL = p.earR = -8
        p.glow = 0.25
        break
      case 'angry':
        p.browL = p.browR = -18
        p.browY = 2
        p.mSmile = 0
        p.mFrown = 0.9
        p.blush = 0
        p.eyeOpen = 0.9
        p.earL = p.earR = -16
        p.glow = 0.2
        break
      case 'love':
        p.happyL = p.happyR = 1
        p.mSmile = 0
        p.mOpen = 1
        p.openAmt = 0.4
        p.blush = 1
        p.glow = 1.3
        p.earL = p.earR = 12
        break
      case 'wink':
        p.happyL = 1
        p.mSmile = 0
        p.mOpen = 1
        p.openAmt = 0.45
        p.blush = 0.3
        break
      default:
        break
    }
  }

  private poseMotion(p: Targets): void {
    const t = this.t
    const f = this.face
    const mt = this.motionT
    const grounded = this.onGround()
    p.tailSide = -f

    // --- held by the scruff
    if (this.held) {
      const swing = sin(t * 9)
      p.eyeOpen = 1.1
      p.mSmile = 0
      p.mO = 1
      p.armLSh = 125 + swing * 16
      p.armRSh = 125 - swing * 16
      p.armLEl = 20
      p.armREl = 20
      p.legLSplay = 12 + swing * 10
      p.legRSplay = 12 - swing * 10
      p.legLLift = -5
      p.legRLift = -5
      p.rootTilt = clamp(-this.dragVX * 0.025, -22, 22)
      p.earL = p.earR = -16
      p.tail1 = 30 + 22 * sin(t * 6)
      p.tail2 = -20 + 20 * sin(t * 6 - 1)
      p.tail3 = -10 + 20 * sin(t * 6 - 2)
      p.faceX = f * 4
      return
    }

    const flying = this.floating || this.flyGoal !== null

    // --- in the air (a jump)
    if (!flying && !grounded) {
      const rising = this.vy < 0
      p.armLSh = p.armRSh = rising ? 150 : 115
      p.armLEl = p.armREl = 10
      p.legLSplay = p.legRSplay = rising ? 8 : 28
      p.legLLift = p.legRLift = rising ? 10 : 0
      p.squash = rising ? 1.1 : 0.98
      if (this.mood === 'neutral') p.mO = 0.6
      p.earL = p.earR = rising ? -4 : 22
      p.tail1 = rising ? 56 : 24
      p.tail2 = rising ? -14 : -30
      p.tail3 = rising ? -4 : -20
      p.faceX = f * 5
      return
    }

    if (flying) {
      this.poseFly(p)
    } else {
      if (this.landT > 0 || this.prepT > 0) p.squash = this.prepT > 0 ? 0.84 : 0.8
      p.faceX = f * (this.walkBlend > 0.2 ? 7 : 3)

      // --- idle baseline: breathing, sway, tail drift
      const br = sin(t * 2.3)
      p.squash *= 1 + br * 0.012
      p.lift = Math.max(0, br) * 0.8
      p.headRot += sin(t * 0.9) * 2.4
      p.armLSh = 7 + sin(t * 1.3) * 2
      p.armRSh = 7 - sin(t * 1.3) * 2
      p.tail1 = 40 + sin(t * 1.5) * 8
      p.tail2 = -34 + sin(t * 1.5 - 0.9) * 14
      p.tail3 = -22 + sin(t * 1.5 - 1.8) * 20
      p.scarf = sin(t * 1.7) * 4
      if (this.twitchT >= 0) {
        const flick = sin((this.twitchT / 0.22) * Math.PI) * 16
        if (this.twitchSide < 0) p.earL += flick
        else p.earR += flick
      }

      const walkW = this.walkBlend
      if (walkW > 0.02) this.poseWalk(p, walkW)
    }

    switch (this.motion) {
      case 'sit':
      case 'sleep':
        this.poseSit(p, this.motion === 'sleep')
        break
      case 'wave': {
        const k = Math.min(1, mt / 0.25) * Math.min(1, (this.motionLen - mt) / 0.3 + 0.0001)
        p.armRSh = 7 + (148 - 7) * k
        p.armREl = 8 + sin(mt * 13) * 30 * k
        p.headRot += -6 * k
        p.tilt = 3 * k
        p.lookX = f * 0.5
        break
      }
      case 'dance': {
        const w = mt * 6.3
        p.lift = Math.abs(sin(w)) * 9
        p.tilt = sin(w * 0.5) * 9
        p.headRot = -sin(w * 0.5) * 8
        p.armLSh = 105 + sin(w) * 45
        p.armRSh = 105 - sin(w) * 45
        p.armLEl = 25
        p.armREl = 25
        p.legLLift = Math.max(0, sin(w)) * 9
        p.legRLift = Math.max(0, -sin(w)) * 9
        p.legLSplay = 8
        p.legRSplay = 8
        p.tail1 = 40 + sin(w * 0.5) * 26
        p.tail2 = -30 + sin(w * 0.5 - 0.8) * 30
        p.tail3 = -20 + sin(w * 0.5 - 1.6) * 34
        p.scarf = sin(w * 0.5) * 22
        p.squash *= 1 + sin(w * 2) * 0.03
        break
      }
      case 'cheer':
        p.armLSh = p.armRSh = 165
        p.armLEl = p.armREl = 8
        break
      case 'spin': {
        const u = clamp(mt / this.motionLen, 0, 1)
        p.spin = Math.cos(u * Math.PI * 2)
        p.lift = sin(u * Math.PI) * 16
        p.armLSh = p.armRSh = 70
        p.tailSide = 1
        break
      }
      case 'stretch': {
        const u = clamp(mt / this.motionLen, 0, 1)
        const k = sin(u * Math.PI)
        p.armLSh = p.armRSh = 8 + 160 * k
        p.squash = 1 + 0.09 * k
        p.eyeOpen = 1 - 0.95 * k
        p.mSmile = 1 - k
        p.mOpen = k
        p.openAmt = 0.95
        p.headRot = -5 * k
        break
      }
      case 'peek': {
        const u = clamp(mt / this.motionLen, 0, 1)
        const k = sin(u * Math.PI)
        p.lookY = -1
        p.lookX = f * 0.3
        p.headRot += -8 * k
        p.headY = -3 * k
        p.lift += 5 * k
        p.earL = p.earR = 16
        p.squash *= 1 + 0.04 * k
        break
      }
      default:
        break
    }

    // --- listening: the microphone is open
    if (this.listening && this.motion === 'idle' && this.activity === null) {
      p.headRot = f * 8 + sin(t * 1.3) * 2
      p.earL = p.earR = 20
      p.lookX = f * 0.4
      p.lookY = -0.1
      p.faceX = f * 5
      p.glow = 1.2
      p.mSmile = 0.7
      p.mFlat = 0.2
    }

    // --- chatting: the chat is open and she is paying attention
    if (this.chatOpen && this.motion === 'idle' && this.activity === null) {
      p.headRot = f * 7 + sin(t * 1.1) * 1.5
      p.tilt = f * 2
      p.lookX = f * 0.9
      p.lookY = 0.1
      p.earL = p.earR = 12
      p.faceX = f * 6
      p.glow = 0.9
    }
  }

  /** Hovering or darting about: legs dangling, a little bob, the body leaning into the direction she flies. */
  private poseFly(p: Targets): void {
    const t = this.t
    const f = this.face
    const speed = Math.hypot(this.fvx, this.fvy)
    const k = clamp(speed / 1000, 0, 1)
    p.faceX = f * 5
    p.lift = 7 + sin(t * 2.6) * 3
    p.tilt = clamp(this.fvx * 0.013, -26, 26)
    p.squash = 1 + 0.04 * k
    p.armLSh = 30 + sin(t * 1.9) * 6 - k * 20
    p.armRSh = 30 - sin(t * 1.9) * 6 - k * 20
    p.armLEl = 14 + k * 30
    p.armREl = 14 + k * 30
    p.legLSplay = 4 + sin(t * 2.1) * 3
    p.legRSplay = 4 - sin(t * 2.1) * 3
    p.legLLift = 5 + sin(t * 2.6) * 2
    p.legRLift = 5 + sin(t * 2.6 + 1) * 2
    p.earL = p.earR = -4 - k * 22
    p.tail1 = 46 + k * 30 + sin(t * 2.2) * 8
    p.tail2 = -26 + k * 20 + sin(t * 2.2 - 0.9) * 14
    p.tail3 = -14 + k * 14 + sin(t * 2.2 - 1.8) * 20
    p.scarf = clamp(-this.fvx * 0.03, -36, 36) + sin(t * 2.4) * 5
    p.lookX = clamp(this.fvx * 0.002, -0.8, 0.8)
    if (this.mood === 'neutral' && k > 0.5) p.mO = 0.35
  }

  private poseOffer(p: Targets): void {
    if (!this.offering) return
    const t = this.t
    p.armLSh = 72 + sin(t * 2.2) * 3
    p.armRSh = 72 - sin(t * 2.2) * 3
    p.armLEl = 28
    p.armREl = 28
    p.headRot = sin(t * 1.4) * 4
    p.lookX = sin(t * 0.9) * 0.6
    p.lookY = 0.1
    p.mSmile = 0.45
    p.mFlat = 0
  }

  /** Pointing: the arm on that side stretches straight toward the target, and she looks at it. */
  private posePoint(p: Targets): void {
    const tg = this.pointTo
    if (!tg) return
    const shoulderY = this.y - this.bodyPx * 0.55
    const dx = tg.x - this.x
    const dy = tg.y - shoulderY
    const ang = clamp((Math.atan2(Math.abs(dx), dy) * 180) / Math.PI, 20, 178)
    if (dx >= 0) {
      p.armRSh = ang
      p.armREl = 2
      if (this.pointGuard) {
        p.armLSh = ang
        p.armLEl = 2
      }
    } else {
      p.armLSh = ang
      p.armLEl = 2
      if (this.pointGuard) {
        p.armRSh = ang
        p.armREl = 2
      }
    }
    p.lookX = clamp(dx / 220, -1, 1)
    p.lookY = clamp(dy / 220, -1, 1)
    p.headRot = clamp(dx * 0.03, -8, 8)
    if (this.pointGuard) {
      p.browL = p.browR = -16
      p.mSmile = 0
      p.mFrown = 0.6
    }
  }

  private poseWalk(p: Targets, w: number): void {
    const f = this.face
    const ph = this.walkPhase
    const run = this.walkSpeed >= RUN_SPEED * 0.8
    const s = sin(ph)
    const amp = run ? 1.5 : 1
    p.legLLift = Math.max(0, s) * 11 * amp * w
    p.legRLift = Math.max(0, -s) * 11 * amp * w
    p.legLSplay = 3 + s * 7 * amp * w
    p.legRSplay = 3 - s * 7 * amp * w
    p.lift = Math.abs(s) * (run ? 7 : 4) * w
    p.tilt = (s * 4 + f * (run ? 11 : 5)) * w
    p.headRot = (-s * 2.5 + f * 3) * w
    p.armLSh = 12 + s * 26 * amp * w
    p.armRSh = 12 - s * 26 * amp * w
    p.armLEl = 12 + (run ? 40 : 12) * w
    p.armREl = 12 + (run ? 40 : 12) * w
    p.squash *= 1 + sin(ph * 2) * 0.03 * w
    p.tail1 = (run ? 58 : 42) + sin(ph * 0.5) * 10 * w
    p.tail2 = (run ? -10 : -34) + sin(ph * 0.5 - 0.9) * 16 * w
    p.tail3 = (run ? 0 : -22) + sin(ph * 0.5 - 1.8) * 22 * w
    p.earL = p.earR = (run ? -12 : -2) * w + 4 + sin(ph * 2 - 0.5) * 5 * w
    p.scarf = (-f * (run ? 28 : 12) + sin(ph) * 6) * w
    p.lookX = f * 0.55
    p.lookY = 0
  }

  private poseSit(p: Targets, asleep: boolean): void {
    const t = this.t
    const k = Math.min(1, this.motionT / 0.5)
    p.sitDrop = 31 * k
    p.legLSplay = 3 + 66 * k
    p.legRSplay = 3 + 66 * k
    p.armLSh = 8 + 24 * k
    p.armRSh = 8 + 24 * k
    p.armLEl = 10 + 12 * k
    p.armREl = 10 + 12 * k
    p.tail1 = 62
    p.tail2 = -38 + sin(t * 1.1) * 6
    p.tail3 = -34 + sin(t * 1.1 - 1) * 8
    p.lift = 0
    if (asleep) {
      const br = sin(t * 1.5)
      p.headRot = 12 + br * 1.5
      p.headY = 6 + br * 1.2
      p.squash = 1 + br * 0.022
      p.eyeOpen = 0.04
      p.mSmile = 0.2
      p.mOpen = 0.55 + br * 0.15
      p.openAmt = 0.18 + Math.max(0, br) * 0.12
      p.earL = p.earR = -14
      p.glow = 0.2 + (br + 1) * 0.08
      p.blush = 0.25
      p.lookX = 0
      p.lookY = 0.4
    } else {
      p.headRot += sin(t * 0.7) * 3
    }
  }

  private poseActivity(p: Targets): void {
    if (!this.activity) return
    const t = this.activityT
    const f = this.face
    const blend = Math.min(1, t / 0.2)
    const mix = (key: keyof Targets, to: number): void => {
      p[key] = p[key] + (to - p[key]) * blend
    }
    switch (this.activity) {
      case 'think':
      case 'settings':
        mix('armRSh', -8)
        mix('armREl', -150)
        mix('headRot', 7 * f)
        mix('lookX', f * 0.6)
        mix('lookY', -0.7)
        mix('browL', 8)
        mix('browR', -6)
        mix('mFlat', 0.8)
        mix('mSmile', 0.1)
        break
      case 'search':
        mix('propMag', 1)
        mix('armRSh', 112)
        mix('armREl', -70)
        mix('headRot', sin(t * 1.5) * 7)
        mix('lookX', sin(t * 2.4) * 0.85)
        mix('lookY', -0.2)
        mix('browL', -6)
        mix('browR', -6)
        break
      case 'read':
        mix('propBook', 1)
        mix('armLSh', -34)
        mix('armLEl', -62)
        mix('armRSh', -34)
        mix('armREl', -62)
        mix('lookX', ((t * 1.7) % 1) * 1.7 - 0.85)
        mix('lookY', 0.55)
        mix('headRot', sin(t * 0.8) * 3)
        break
      case 'type':
        mix('propLaptop', 1)
        mix('armLSh', -42)
        mix('armRSh', -42)
        mix('armLEl', -66 + sin(t * 22) * 9)
        mix('armREl', -66 + sin(t * 22 + Math.PI) * 9)
        mix('lookY', 0.45)
        mix('mFlat', 0.7)
        mix('mSmile', 0.2)
        mix('headY', sin(t * 11) * 0.8)
        break
      case 'click':
        mix('armRSh', 98 + sin(t * 8.8) * 8)
        mix('armREl', -22)
        mix('lookX', f * 0.8)
        mix('headRot', 4 * f)
        break
      case 'tabs':
        mix('armRSh', 168)
        mix('armREl', 4 + sin(t * 6) * 5)
        mix('lookY', -0.9)
        mix('headRot', -5)
        break
      case 'bookmark':
        mix('armLSh', 130)
        mix('armRSh', 130)
        mix('happyL', 0.9)
        mix('happyR', 0.9)
        break
      default:
        break
    }
  }

  private poseTalk(p: Targets): void {
    if (!this.speaking) return
    const t = this.t
    const open = this.mouthLevel !== null ? clamp(0.08 + this.mouthLevel * 1.5, 0.08, 1) : 0.18 + Math.abs(sin(t * 13 + sin(t * 3.1) * 2)) * 0.78
    p.mOpen = 1
    p.mSmile = 0
    p.mO = 0
    p.mFrown = 0
    p.mFlat = 0
    p.openAmt = open
    p.headY += sin(t * 6.5) * 0.9
    p.headRot += sin(t * 2.2) * 2
    if (this.motion === 'idle' && this.activity === null) {
      p.armRSh += 10 + sin(t * 4.1) * 14
      p.armREl += sin(t * 4.1 + 1) * 14
    }
  }

  /** Hair and ribbons trail behind the head and body: they lean against whatever way those move. */
  private poseHair(p: Targets): void {
    const lag = -(p.headRot * 0.9 + p.tilt * 0.7) - p.lift * 0.5 + sin(this.t * 1.6) * 2.5
    p.hair = clamp(lag + (this.held ? -this.dragVX * 0.02 : 0), -38, 38)
  }

  private poseEyes(p: Targets): void {
    if (this.blinkT >= 0) p.eyeOpen *= 1 - Math.sin((this.blinkT / 0.16) * Math.PI)
    // look: keep a pose's own gaze (looking at the page, away…) and add the idle wandering / pointer following
    if (this.motion === 'idle' && this.activity === null && this.mood === 'neutral' && !this.chatOpen && this.walkBlend < 0.1) {
      if (this.pointer) {
        p.lookX = clamp((this.pointer.x - this.x) / 90, -1, 1)
        p.lookY = clamp((this.pointer.y - (this.y - this.bodyPx * 0.6)) / 90, -1, 1)
      } else {
        p.lookX = this.lookGoal.x
        p.lookY = this.lookGoal.y
      }
    }
  }
}
