import { forwardRef } from 'react'
import type { PersonaId } from '@shared/ai'

/** The drawing is 260×270 units; the feet touch the ground at (100, GROUND_Y). */
export const SVG_W = 260
export const SVG_H = 270
export const GROUND_Y = 258
export const ORIGIN_X = 100

/** How the two characters differ in build; the rig reads these. */
export const BUILD: Record<PersonaId, { head: number; torsoX: number }> = {
  girl: { head: 1.12, torsoX: 1 },
  boy: { head: 1.02, torsoX: 1.1 }
}

type Variant = PersonaId

const CatEar = ({ part, x }: { part: string; x: number }): JSX.Element => (
  <g data-part={part} transform={`translate(${x} -70)`}>
    <path className="lm-hair lm-ink" d="M -18 6 C -26 -18 -14 -42 -2 -50 C 14 -40 26 -16 20 6 Z" />
    <path className="lm-ear-inner" d="M -9 2 C -13 -14 -7 -28 -1 -33 C 8 -26 14 -12 11 2 Z" />
  </g>
)

const FoxEar = ({ part, x }: { part: string; x: number }): JSX.Element => (
  <g data-part={part} transform={`translate(${x} -72)`}>
    <path className="lm-hair lm-ink" d="M -20 8 C -27 -24 -13 -54 1 -66 C 17 -50 29 -22 23 8 Z" />
    <path className="lm-ear-inner" d="M -10 3 C -14 -20 -7 -38 1 -47 C 10 -36 16 -18 12 3 Z" />
  </g>
)

const Eye = ({ side, x, variant }: { side: 'L' | 'R'; x: number; variant: Variant }): JSX.Element => {
  const girl = variant === 'girl'
  return (
    <g transform={`translate(${x} -34)`}>
      <g data-part={`eye${side}`}>
        <ellipse className="lm-eye" rx={girl ? 11 : 9.6} ry={girl ? 14 : 13.4} />
        <ellipse className="lm-iris" cx="0" cy="3.5" rx={girl ? 8.2 : 7} ry={girl ? 9.6 : 9} />
        <g data-part={`look${side}`}>
          <circle className="lm-shine" cx={girl ? -3.8 : -3.2} cy="-4.8" r={girl ? 4.6 : 3.8} />
          <circle className="lm-shine" cx="3.6" cy="5" r={girl ? 2.2 : 1.8} />
        </g>
        {girl ? (
          <path className="lm-lash" d={side === 'L' ? 'M -13 -6 Q -6 -17 10 -12 M -13 -6 L -17 -9' : 'M 13 -6 Q 6 -17 -10 -12 M 13 -6 L 17 -9'} />
        ) : (
          <path className="lm-lash lm-lash--thin" d={side === 'L' ? 'M -11 -10 Q 0 -16 10 -11' : 'M 11 -10 Q 0 -16 -10 -11'} />
        )}
      </g>
      <path data-part={`happy${side}`} className="lm-stroke" d="M -10.5 4 Q 0 -12 10.5 4" opacity="0" />
    </g>
  )
}

const Arm = ({ side, x, variant }: { side: 'L' | 'R'; x: number; variant: Variant }): JSX.Element => {
  const girl = variant === 'girl'
  return (
    <g data-part={`arm${side}`} transform={`translate(${x} -40)`}>
      <rect className={`${girl ? 'lm-skin' : 'lm-cloth'} lm-ink`} x="-8" y="-5" width="16" height="31" rx="8" />
      {girl && <path className="lm-cloth lm-ink" d="M -8 1 C -8 -8 8 -8 8 1 L 8 11 L -8 11 Z" />}
      <g data-part={`elbow${side}`} transform="translate(0 22)">
        <rect className={`${girl ? 'lm-skin' : 'lm-cloth'} lm-ink`} x="-7.5" y="-4" width="15" height="27" rx="7.5" />
        {!girl && <rect className="lm-cuff lm-ink" x="-8.2" y="14" width="16.4" height="7" rx="3" />}
        <circle className="lm-skin lm-ink" cx="0" cy="24" r="9.6" />
        {side === 'R' && (
          <g data-part="propMag" transform="translate(0 22)" opacity="0">
            <g transform="rotate(-24)">
              <line className="lm-handle" x1="0" y1="0" x2="0" y2="-20" />
              <circle className="lm-glass lm-ink" cx="0" cy="-35" r="16" />
              <path className="lm-glint" d="M -8 -40 Q -6 -46 0 -48" />
            </g>
          </g>
        )}
      </g>
    </g>
  )
}

const Leg = ({ side, x, variant }: { side: 'L' | 'R'; x: number; variant: Variant }): JSX.Element => {
  const girl = variant === 'girl'
  return (
    <g data-part={`leg${side}`} transform={`translate(${x} -50)`}>
      <rect className={`${girl ? 'lm-sock' : 'lm-pants'} lm-ink`} x="-11" y="-6" width="22" height="47" rx="11" />
      {girl && <path className="lm-sockband" d="M -10.5 26 L 10.5 26" />}
      <ellipse className="lm-shoe lm-ink" cx="0" cy="40" rx="17" ry="9.5" />
    </g>
  )
}

/** Lumi (girl) or Lux (boy), drawn as a rig: every moving part is a group with a `data-part` the animation engine drives. */
const MascotSvg = forwardRef<SVGSVGElement, { variant: Variant }>(function MascotSvg({ variant }, ref) {
  const girl = variant === 'girl'
  return (
    <svg ref={ref} className={`lm-svg lm-var-${variant}`} viewBox={`0 0 ${SVG_W} ${SVG_H}`} aria-hidden="true">
      <defs>
        <radialGradient id="lm-orb">
          <stop offset="0%" style={{ stopColor: 'var(--lm-glow)', stopOpacity: 0.95 }} />
          <stop offset="45%" style={{ stopColor: 'var(--lm-glow)', stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: 'var(--lm-glow)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>

      <ellipse data-part="shadow" cx={ORIGIN_X} cy={GROUND_Y + 1} rx="46" ry="8" className="lm-shadow" />

      <g data-part="root" transform={`translate(${ORIGIN_X} ${GROUND_Y})`}>
        {/* tail: three segments, each following the one before it */}
        <g data-part="tailBase" transform="translate(33 -32)">
          <g data-part="tail1">
            <rect className="lm-hair lm-ink" x={girl ? -10 : -13} y="-31" width={girl ? 20 : 26} height="38" rx={girl ? 10 : 13} />
            <g data-part="tail2" transform="translate(0 -26)">
              <rect className="lm-hair lm-ink" x={girl ? -9.5 : -14} y="-31" width={girl ? 19 : 28} height="38" rx={girl ? 9.5 : 14} />
              <g data-part="tail3" transform="translate(0 -26)">
                <rect className={girl ? 'lm-acc lm-ink' : 'lm-tailtip lm-ink'} x={girl ? -9 : -12} y="-31" width={girl ? 18 : 24} height="38" rx={girl ? 9 : 12} />
                <circle data-part="tailGlow" className="lm-orb" cx="0" cy="-30" r="22" fill="url(#lm-orb)" />
                <circle className="lm-core" cx="0" cy="-30" r="6.5" />
              </g>
            </g>
          </g>
        </g>

        <Leg side="R" x={girl ? 18 : 19} variant={variant} />
        <Leg side="L" x={girl ? -18 : -19} variant={variant} />

        <g data-part="torso" transform="translate(0 -50)">
          {girl ? (
            <>
              <path className="lm-cloth lm-ink" d="M -34 3 C -41 -24 -33 -54 0 -56 C 33 -54 41 -24 34 3 C 28 11 -28 11 -34 3 Z" />
              <path className="lm-collar lm-ink" d="M -22 -53 L 0 -30 L 22 -53 L 14 -56 L 0 -44 L -14 -56 Z" />
              <path className="lm-stripe" d="M -29 -16 Q 0 -8 29 -16" />
              <path className="lm-skirt lm-ink" d="M -35 0 C -36 -3 36 -3 35 0 L 48 26 C 30 33 -30 33 -48 26 Z" />
              <path className="lm-fold" d="M -16 4 L -22 28 M 0 5 L 0 30 M 16 4 L 22 28" />
            </>
          ) : (
            <>
              <path className="lm-cloth lm-ink" d="M -37 3 C -44 -24 -36 -54 0 -56 C 36 -54 44 -24 37 3 C 30 11 -30 11 -37 3 Z" />
              <path className="lm-shirt lm-ink" d="M -12 -56 L 0 -20 L 12 -56 Z" />
              <path className="lm-zip" d="M 0 -20 L 0 8" />
              <path className="lm-stripe" d="M -32 -4 L -26 4 M 32 -4 L 26 4" />
              <path className="lm-pocket lm-ink" d="M -26 -6 L -12 -6 L -12 6 L -26 6 Z" />
            </>
          )}
          <g data-part="propBook" opacity="0" transform="translate(0 -18)">
            <path className="lm-page lm-ink" d="M -1 -14 L -33 -9 L -33 18 L -1 22 Z" />
            <path className="lm-page lm-ink" d="M 1 -14 L 33 -9 L 33 18 L 1 22 Z" />
            <path className="lm-lines" d="M -26 -1 L -8 1 M -26 6 L -8 8 M 8 1 L 26 -1 M 8 8 L 26 6" />
          </g>
          <g data-part="propLaptop" opacity="0" transform="translate(0 -16)">
            <rect className="lm-lid lm-ink" x="-37" y="-28" width="74" height="46" rx="7" />
            <path className="lm-logo" d="M0 -17 L2.6 -9.4 L10 -6.5 L2.6 -3.6 L0 4 L-2.6 -3.6 L-10 -6.5 L-2.6 -9.4 Z" />
            <rect className="lm-fur2 lm-ink" x="-42" y="16" width="84" height="6" rx="3" />
          </g>

          {/* the scarf's end (boy) / the ribbon's tail (girl) */}
          <g data-part="scarfEnd" transform="translate(21 -36)">
            {girl ? (
              <path className="lm-bow lm-ink" d="M -6 0 L 8 0 L 12 20 L 1 15 L -4 22 Z" />
            ) : (
              <>
                <path className="lm-acc lm-ink" d="M -8 0 L 10 0 L 15 34 L -1 39 Z" />
                <path className="lm-stripe" d="M -4 16 L 12 14" />
              </>
            )}
          </g>
          {girl ? (
            <>
              <path className="lm-bow lm-ink" d="M -26 -50 Q -8 -38 0 -44 Q 8 -38 26 -50 L 22 -40 Q 8 -32 0 -37 Q -8 -32 -22 -40 Z" />
              <circle className="lm-bow lm-ink" cx="0" cy="-41" r="6" />
            </>
          ) : (
            <path className="lm-acc lm-ink" d="M -36 -52 Q 0 -36 36 -52 L 39 -39 Q 0 -22 -39 -39 Z" />
          )}

          <g data-part="head" transform={`translate(0 -50) scale(${BUILD[variant].head})`}>
            {/* hair and ears behind the head */}
            {girl ? (
              <>
                <g transform="translate(-52 -58)">
                  <g data-part="hairL">
                    <path className="lm-hair lm-ink" d="M 6 0 C -12 16 -16 56 -4 84 C 4 94 14 78 12 54 C 10 30 12 10 12 0 Z" />
                    <rect className="lm-bow lm-ink" x="-3" y="-4" width="20" height="10" rx="5" />
                  </g>
                </g>
                <g transform="translate(52 -58)">
                  <g data-part="hairR">
                    <path className="lm-hair lm-ink" d="M -6 0 C 12 16 16 56 4 84 C -4 94 -14 78 -12 54 C -10 30 -12 10 -12 0 Z" />
                    <rect className="lm-bow lm-ink" x="-17" y="-4" width="20" height="10" rx="5" />
                  </g>
                </g>
                <CatEar part="earL" x={-36} />
                <CatEar part="earR" x={36} />
              </>
            ) : (
              <>
                <path className="lm-hair lm-ink" d="M -50 -20 C -64 -50 -52 -80 -30 -90 L 0 -60 L 30 -90 C 52 -80 64 -50 50 -20 Z" />
                <FoxEar part="earL" x={-34} />
                <FoxEar part="earR" x={34} />
              </>
            )}
            <path
              className="lm-skin lm-ink"
              d={
                girl
                  ? 'M -56 -36 C -58 -72 -30 -88 0 -88 C 30 -88 58 -72 56 -36 C 55 -8 30 6 0 6 C -30 6 -55 -8 -56 -36 Z'
                  : 'M -52 -38 C -54 -74 -28 -88 0 -88 C 28 -88 54 -74 52 -38 C 51 -14 30 8 0 8 C -30 8 -51 -14 -52 -38 Z'
              }
            />

            <g data-part="face">
              <ellipse data-part="blushL" className="lm-blush" cx="-38" cy="-17" rx="9" ry="5.5" />
              <ellipse data-part="blushR" className="lm-blush" cx="38" cy="-17" rx="9" ry="5.5" />
              <Eye side="L" x={girl ? -22 : -21} variant={variant} />
              <Eye side="R" x={girl ? 22 : 21} variant={variant} />
              <path data-part="tearL" className="lm-tear" d="M -26 -18 Q -30 -9 -26 -6 Q -22 -9 -26 -18 Z" opacity="0" />
              <g data-part="browL" transform="translate(-22 -55)">
                <path className={`lm-stroke ${girl ? 'lm-brow--girl' : 'lm-brow--boy'}`} d="M -9 1 Q 0 -3 9 1" />
              </g>
              <g data-part="browR" transform="translate(22 -55)">
                <path className={`lm-stroke ${girl ? 'lm-brow--girl' : 'lm-brow--boy'}`} d="M -9 1 Q 0 -3 9 1" />
              </g>
              <path className="lm-nosemark" d="M -1.5 -17 Q 0 -15.5 1.5 -17" />
              <g transform="translate(0 -10)">
                <path data-part="mSmile" className="lm-stroke lm-stroke--thin" d={girl ? 'M -8 -1 Q -4 6 0 0 Q 4 6 8 -1' : 'M -8 0 Q 0 6 8 0'} />
                <g data-part="mOpen" opacity="0">
                  <path className="lm-mouth" d="M -9.5 0 Q 0 4 9.5 0 Q 9.5 16 0 16 Q -9.5 16 -9.5 0 Z" />
                  <ellipse className="lm-tongue" cx="0" cy="11.5" rx="5.4" ry="3.4" />
                </g>
                <ellipse data-part="mO" className="lm-mouth" cx="0" cy="6" rx="5" ry="6.5" opacity="0" />
                <path data-part="mFrown" className="lm-stroke lm-stroke--thin" d="M -8 6 Q 0 -2 8 6" opacity="0" />
                <path data-part="mFlat" className="lm-stroke lm-stroke--thin" d="M -6 2 L 6 2" opacity="0" />
              </g>
            </g>

            {/* hair in front of the face */}
            {girl ? (
              <>
                <path
                  className="lm-hair lm-ink"
                  d="M -58 -38 C -62 -82 -30 -98 0 -98 C 30 -98 62 -82 58 -38 C 54 -54 46 -64 32 -60 C 24 -68 8 -64 0 -50 C -8 -64 -24 -68 -32 -60 C -46 -64 -54 -54 -58 -38 Z"
                />
                <path className="lm-hair lm-ink" d="M -58 -40 C -62 -22 -58 -6 -50 4 C -52 -10 -50 -26 -48 -40 Z" />
                <path className="lm-hair lm-ink" d="M 58 -40 C 62 -22 58 -6 50 4 C 52 -10 50 -26 48 -40 Z" />
                <path className="lm-ahoge" d="M 0 -96 C -6 -112 6 -118 10 -108" />
              </>
            ) : (
              <>
                <path
                  className="lm-hair lm-ink"
                  d="M -54 -40 C -58 -90 -26 -104 0 -104 C 26 -104 58 -90 54 -40 L 50 -56 L 46 -36 L 36 -64 L 26 -42 L 12 -70 L 2 -44 L -10 -70 L -22 -42 L -36 -64 L -44 -36 L -50 -56 Z"
                />
                <path className="lm-streak" d="M 14 -98 C 24 -92 30 -76 30 -62 L 18 -76 L 10 -66 Z" />
                <g transform="translate(-52 -36)">
                  <g data-part="hairL">
                    <path className="lm-hair lm-ink" d="M 0 0 L -5 34 L 8 22 L 6 0 Z" />
                  </g>
                </g>
                <g transform="translate(52 -36)">
                  <g data-part="hairR">
                    <path className="lm-hair lm-ink" d="M 0 0 L 5 34 L -8 22 L -6 0 Z" />
                  </g>
                </g>
              </>
            )}
            <g data-part="spark" transform={girl ? 'translate(30 -70)' : 'translate(-28 -74)'}>
              <circle className="lm-orb" r="17" fill="url(#lm-orb)" />
              <path className="lm-acc lm-ink--thin" d="M0 -8 L2.2 -2.2 L8 0 L2.2 2.2 L0 8 L-2.2 2.2 L-8 0 L-2.2 -2.2 Z" />
            </g>
          </g>

          <Arm side="L" x={girl ? -35 : -38} variant={variant} />
          <Arm side="R" x={girl ? 35 : 38} variant={variant} />
        </g>
      </g>
    </svg>
  )
})

export default MascotSvg
