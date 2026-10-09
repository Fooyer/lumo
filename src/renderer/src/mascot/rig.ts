/**
 * The animation engine for Lumi's puppet. `Targets` is a flat list of numbers describing a pose (angles in
 * degrees, "outward" being away from the body); the behavior code writes the pose it wants every frame, and
 * each number chases its target through a damped spring — which is what makes every change of pose flow into
 * the next instead of snapping. Then `apply` turns the springs' values into SVG transforms.
 */

export interface Targets {
  // whole body
  /** px the whole body is raised. */
  lift: number
  /** Squash (<1) and stretch (>1) of the height; the width does the opposite, anchored at the feet. */
  squash: number
  /** Horizontal flip for spins: 1 = facing the viewer, 0 = edge-on. */
  spin: number
  rootTilt: number
  /** px the hips drop (sitting); the legs go with them. */
  sitDrop: number
  tilt: number
  torsoX: number
  // head & face
  headRot: number
  headX: number
  headY: number
  /** Face features slide sideways to suggest the head turning. */
  faceX: number
  earL: number
  earR: number
  lookX: number
  lookY: number
  eyeOpen: number
  happyL: number
  happyR: number
  browL: number
  browR: number
  browY: number
  mSmile: number
  mOpen: number
  mO: number
  mFrown: number
  mFlat: number
  /** How wide the open mouth is, 0-1. */
  openAmt: number
  blush: number
  tear: number
  glow: number
  // limbs (degrees, outward-positive)
  armLSh: number
  armLEl: number
  armRSh: number
  armREl: number
  legLLift: number
  legRLift: number
  legLSplay: number
  legRSplay: number
  // tail & scarf
  tailSide: number
  tail1: number
  tail2: number
  tail3: number
  scarf: number
  /** Sway of the hair, degrees. */
  hair: number
  // props
  propMag: number
  propBook: number
  propLaptop: number
}

export const REST: Targets = {
  lift: 0,
  squash: 1,
  spin: 1,
  rootTilt: 0,
  sitDrop: 0,
  tilt: 0,
  torsoX: 0,
  headRot: 0,
  headX: 0,
  headY: 0,
  faceX: 0,
  earL: 4,
  earR: 4,
  lookX: 0,
  lookY: 0,
  eyeOpen: 1,
  happyL: 0,
  happyR: 0,
  browL: 0,
  browR: 0,
  browY: 0,
  mSmile: 1,
  mOpen: 0,
  mO: 0,
  mFrown: 0,
  mFlat: 0,
  openAmt: 0.5,
  blush: 0.15,
  tear: 0,
  glow: 0.6,
  armLSh: 8,
  armLEl: 10,
  armRSh: 8,
  armREl: 10,
  legLLift: 0,
  legRLift: 0,
  legLSplay: 3,
  legRSplay: 3,
  tailSide: 1,
  tail1: 42,
  tail2: -34,
  tail3: -24,
  scarf: 0,
  hair: 0,
  propMag: 0,
  propBook: 0,
  propLaptop: 0
}

type Key = keyof Targets

/** [stiffness, damping] per parameter: the defaults overshoot a little (lively); a few need to be quick or floppy. */
const SPRINGS: Partial<Record<Key, [number, number]>> = {
  eyeOpen: [900, 60],
  happyL: [500, 40],
  happyR: [500, 40],
  mSmile: [420, 36],
  mOpen: [420, 36],
  mO: [420, 36],
  mFrown: [420, 36],
  mFlat: [420, 36],
  openAmt: [600, 44],
  propMag: [500, 40],
  propBook: [500, 40],
  propLaptop: [500, 40],
  lookX: [380, 32],
  lookY: [380, 32],
  squash: [330, 17],
  tail1: [120, 9],
  tail2: [110, 8],
  tail3: [100, 7],
  scarf: [90, 7],
  hair: [75, 5.5],
  earL: [200, 13],
  earR: [200, 13],
  lift: [520, 34],
  sitDrop: [200, 21],
  spin: [900, 70]
}
const DEFAULT_SPRING: [number, number] = [260, 22]

const KEYS = Object.keys(REST) as Key[]

/** Where the two characters keep the parts that sit differently on each of them. */
const LAYOUT = {
  girl: { armX: 35, legX: 18, earX: 36, earY: 70, sparkX: 30, sparkY: -70, head: 1.12, torsoX: 1 },
  boy: { armX: 38, legX: 19, earX: 34, earY: 72, sparkX: -28, sparkY: -74, head: 1.02, torsoX: 1.1 }
} as const

export class Rig {
  readonly v: Targets = { ...REST }
  private vel: Record<string, number> = {}
  private parts = new Map<string, SVGElement>()
  private layout: (typeof LAYOUT)[keyof typeof LAYOUT]

  constructor(
    private svg: SVGSVGElement,
    variant: 'girl' | 'boy' = 'girl'
  ) {
    this.layout = LAYOUT[variant]
    svg.querySelectorAll<SVGElement>('[data-part]').forEach((el) => this.parts.set(el.dataset.part as string, el))
    for (const k of KEYS) this.vel[k] = 0
  }

  /** Jumps straight to a pose (used for the first frame). */
  snap(t: Partial<Targets>): void {
    Object.assign(this.v, t)
    for (const k of KEYS) this.vel[k] = 0
    this.apply()
  }

  /** Advances every spring by dt seconds toward the targets, then redraws. */
  step(dt: number, target: Targets): void {
    // Small fixed sub-steps keep the springs stable when a frame is slow.
    const steps = Math.max(1, Math.ceil(dt / 0.008))
    const h = dt / steps
    for (let s = 0; s < steps; s++) {
      for (const k of KEYS) {
        const [stiff, damp] = SPRINGS[k] ?? DEFAULT_SPRING
        const x = this.v[k]
        const acc = stiff * (target[k] - x) - damp * this.vel[k]
        this.vel[k] += acc * h
        this.v[k] = x + this.vel[k] * h
      }
    }
    this.apply()
  }

  private set(part: string, transform: string): void {
    this.parts.get(part)?.setAttribute('transform', transform)
  }

  private opacity(part: string, value: number): void {
    this.parts.get(part)?.setAttribute('opacity', String(Math.max(0, Math.min(1, value))))
  }

  private apply(): void {
    const v = this.v
    const sx = (1 / Math.sqrt(Math.max(0.3, v.squash))) * Math.max(0.02, Math.abs(v.spin))
    const flip = v.spin < 0 ? -1 : 1
    this.set('root', `translate(100 ${258 - v.lift}) rotate(${v.rootTilt}) scale(${(sx * flip).toFixed(4)} ${v.squash.toFixed(4)})`)
    this.parts.get('shadow')?.setAttribute('rx', String(46 * (1 - Math.min(0.5, v.lift / 260)) * sx))
    this.opacity('shadow', 1 - Math.min(0.6, v.lift / 200))

    this.set('torso', `translate(${v.torsoX.toFixed(2)} ${(-50 + v.sitDrop).toFixed(2)}) rotate(${v.tilt.toFixed(2)}) scale(${this.layout.torsoX} 1)`)
    this.set('head', `translate(${v.headX.toFixed(2)} ${(-50 + v.headY).toFixed(2)}) rotate(${v.headRot.toFixed(2)}) scale(${this.layout.head})`)
    this.set('face', `translate(${v.faceX.toFixed(2)} 0)`)

    // upward-pointing parts lean outward with  s·a ; downward-pointing ones with  −s·a  (s = -1 left, +1 right)
    this.set('earL', `translate(${-this.layout.earX} ${-this.layout.earY}) rotate(${(-v.earL).toFixed(2)})`)
    this.set('earR', `translate(${this.layout.earX} ${-this.layout.earY}) rotate(${v.earR.toFixed(2)})`)
    this.set('hairL', `rotate(${v.hair.toFixed(2)})`)
    this.set('hairR', `rotate(${v.hair.toFixed(2)})`)

    this.set('armL', `translate(${-this.layout.armX} -40) rotate(${v.armLSh.toFixed(2)})`)
    this.set('elbowL', `translate(0 22) rotate(${v.armLEl.toFixed(2)})`)
    this.set('armR', `translate(${this.layout.armX} -40) rotate(${(-v.armRSh).toFixed(2)})`)
    this.set('elbowR', `translate(0 22) rotate(${(-v.armREl).toFixed(2)})`)

    this.set('legL', `translate(${-this.layout.legX} ${(-50 + v.sitDrop - v.legLLift).toFixed(2)}) rotate(${v.legLSplay.toFixed(2)})`)
    this.set('legR', `translate(${this.layout.legX} ${(-50 + v.sitDrop - v.legRLift).toFixed(2)}) rotate(${(-v.legRSplay).toFixed(2)})`)

    // tail swings on the side opposite to where she looks; its sign follows tailSide
    this.set('tailBase', `translate(${(33 * v.tailSide).toFixed(2)} ${(-32 + v.sitDrop).toFixed(2)})`)
    this.set('tail1', `rotate(${((v.tail1 + 18) * v.tailSide).toFixed(2)})`)
    this.set('tail2', `translate(0 -26) rotate(${((v.tail2 + 8) * v.tailSide).toFixed(2)})`)
    this.set('tail3', `translate(0 -26) rotate(${((v.tail3 + 4) * v.tailSide).toFixed(2)})`)
    this.set('scarfEnd', `translate(21 -36) rotate(${v.scarf.toFixed(2)})`)

    // face
    const open = Math.max(0, Math.min(1.15, v.eyeOpen))
    const eyeScale = `scale(1 ${Math.max(0.04, open).toFixed(3)})`
    this.set('eyeL', eyeScale)
    this.set('eyeR', eyeScale)
    const lx = (v.lookX * 3.2).toFixed(2)
    const ly = (v.lookY * 3).toFixed(2)
    this.set('lookL', `translate(${lx} ${ly})`)
    this.set('lookR', `translate(${lx} ${ly})`)
    this.opacity('happyL', v.happyL)
    this.opacity('happyR', v.happyR)
    this.parts.get('eyeL')?.setAttribute('opacity', String(1 - Math.min(1, v.happyL)))
    this.parts.get('eyeR')?.setAttribute('opacity', String(1 - Math.min(1, v.happyR)))
    this.set('browL', `translate(-22 ${(-55 + v.browY).toFixed(2)}) rotate(${(-v.browL).toFixed(2)})`)
    this.set('browR', `translate(22 ${(-55 + v.browY).toFixed(2)}) rotate(${v.browR.toFixed(2)})`)
    this.opacity('mSmile', v.mSmile)
    this.opacity('mOpen', v.mOpen)
    this.set('mOpen', `scale(1 ${Math.max(0.05, v.openAmt).toFixed(3)})`)
    this.opacity('mO', v.mO)
    this.opacity('mFrown', v.mFrown)
    this.opacity('mFlat', v.mFlat)
    this.opacity('blushL', v.blush)
    this.opacity('blushR', v.blush)
    this.opacity('tearL', v.tear)
    const glow = Math.max(0, v.glow)
    this.set('spark', `translate(${this.layout.sparkX} ${this.layout.sparkY}) scale(${(0.8 + glow * 0.5).toFixed(3)})`)
    this.opacity('tailGlow', 0.35 + glow * 0.65)

    this.opacity('propMag', v.propMag)
    this.opacity('propBook', v.propBook)
    this.opacity('propLaptop', v.propLaptop)
  }
}
