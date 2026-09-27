import { useId, useMemo } from 'react'
import type { Zone } from '../api/types'
import {
  acceptableArc, bearingDeg, compassPoint, haversineKm, polar, wedgePath,
} from '../lib/geo'
import { riderColor } from './riderColors'

export interface RadarMember {
  key: string
  label: string
  destinationId: number
  colorIndex: number
}

export interface RadarProposal {
  key: string
  label: string
  destinationId: number
  joinable: boolean
}

interface Props {
  zones: Zone[]
  originId: number
  members?: RadarMember[]
  proposals?: RadarProposal[]
  /** Makes every zone a button — used to pick a destination by tapping the map. */
  onZoneClick?: (zoneId: number) => void
  selectedId?: number | null
  /** The rotating sweep; the driver console runs it while online. */
  sweeping?: boolean
  /** Shade the arc a new destination may point in and still pool. */
  showOpenArc?: boolean
  className?: string
  title?: string
}

const SIZE = 400
const C = SIZE / 2
const R = 148
const RING_KM = [1, 2, 4, 8, 12, 16, 24]
const SWEEP_SLICES = 16

export function RouteRadar({
  zones, originId, members = [], proposals = [], onZoneClick, selectedId,
  sweeping = false, showOpenArc = true, className = '', title = 'Direction radar',
}: Props) {
  const uid = useId().replace(/:/g, '')
  const origin = zones.find(z => z.id === originId)

  const layout = useMemo(() => (origin ? computeLayout(zones, origin) : null), [zones, origin])

  if (!origin || !layout) {
    return (
      <div className={`grid aspect-square place-items-center rounded-full border border-line ${className}`}>
        <span className="eyebrow">Choose a pickup zone</span>
      </div>
    )
  }

  const { byId, radius, rings, labels, originLabel } = layout
  const memberBearings = members
    .map(m => byId.get(m.destinationId)?.bearing)
    .filter((b): b is number => b !== undefined)
  const arc = showOpenArc ? acceptableArc(memberBearings) : null

  const occupied = new Set([
    ...members.map(m => m.destinationId),
    ...proposals.map(p => p.destinationId),
    ...(selectedId ? [selectedId] : []),
  ])

  return (
    <figure className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-labelledby={`${uid}-title ${uid}-desc`}
      >
        <title id={`${uid}-title`}>{title}</title>
        <desc id={`${uid}-desc`}>
          {describe(origin.name, members, proposals, byId, arc)}
        </desc>

        <defs>
          <radialGradient id={`${uid}-field`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.10" />
            <stop offset="70%" stopColor="var(--surface-2)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--surface-2)" stopOpacity="0.9" />
          </radialGradient>
          <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id={`${uid}-clip`}>
            <circle cx={C} cy={C} r={R} />
          </clipPath>
        </defs>

        {/* field */}
        <circle cx={C} cy={C} r={R} fill={`url(#${uid}-field)`} stroke="var(--line-2)" strokeWidth="1.25" />

        {/* the open heading — where a new rider may still be going */}
        {arc && (
          <g clipPath={`url(#${uid}-clip)`}>
            <path
              d={wedgePath(arc.start, arc.sweep, R, C, C)}
              fill="var(--signal)"
              fillOpacity="0.1"
              stroke="var(--signal)"
              strokeOpacity="0.45"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
          </g>
        )}

        {/* range rings */}
        {rings.map(({ km, label }) => {
          const r = radius(km)
          return (
            <g key={km}>
              <circle cx={C} cy={C} r={r} fill="none" stroke="var(--line-2)" strokeOpacity="0.55" strokeDasharray="2 5" />
              {label && (
                <text x={label.x} y={label.y} className="fill-ink-3 font-mono" fontSize="8.5">
                  {km} km
                </text>
              )}
            </g>
          )
        })}

        {/* crosshair + bearing ticks */}
        <g stroke="var(--line-2)" strokeOpacity="0.5">
          <line x1={C} y1={C - R} x2={C} y2={C + R} strokeWidth="0.75" />
          <line x1={C - R} y1={C} x2={C + R} y2={C} strokeWidth="0.75" />
          {Array.from({ length: 36 }, (_, i) => {
            const deg = i * 10
            const major = deg % 30 === 0
            const a = polar(deg, R, C, C)
            const b = polar(deg, R + (major ? 7 : 3.5), C, C)
            return <line key={deg} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={major ? 1.25 : 0.75} strokeOpacity={major ? 0.9 : 0.5} />
          })}
        </g>
        {(['N', 'E', 'S', 'W'] as const).map((l, i) => {
          const p = polar(i * 90, R + 19, C, C)
          return (
            <text
              key={l}
              x={p.x}
              y={p.y + 3.5}
              textAnchor="middle"
              fontSize="11"
              fontWeight={l === 'N' ? 800 : 600}
              className={`font-mono ${l === 'N' ? 'fill-marigold' : 'fill-ink-3'}`}
            >
              {l}
            </text>
          )
        })}

        {/* sweep */}
        {sweeping && (
          <g clipPath={`url(#${uid}-clip)`}>
            <g className="animate-sweep" style={{ transformOrigin: `${C}px ${C}px`, transformBox: 'view-box' }}>
              {Array.from({ length: SWEEP_SLICES }, (_, i) => (
                <path
                  key={i}
                  d={wedgePath(360 - (i + 1) * 3, 3.2, R, C, C)}
                  fill="var(--signal)"
                  fillOpacity={0.2 * (1 - i / SWEEP_SLICES) ** 2}
                />
              ))}
              <line x1={C} y1={C} x2={C} y2={C - R} stroke="var(--signal)" strokeOpacity="0.7" strokeWidth="1.25" />
            </g>
          </g>
        )}

        {/* proposed legs — requests the driver could still accept */}
        {proposals.map(p => {
          const dest = byId.get(p.destinationId)
          if (!dest) return null
          const end = polar(dest.bearing, dest.r, C, C)
          const color = p.joinable ? 'var(--signal)' : 'var(--alert)'
          return (
            <g key={p.key}>
              <line
                x1={C} y1={C} x2={end.x} y2={end.y}
                stroke={color} strokeWidth="1.75" strokeDasharray="5 5" strokeLinecap="round"
                strokeOpacity={p.joinable ? 0.9 : 0.75}
              />
              <circle cx={end.x} cy={end.y} r="7" fill="var(--paper)" stroke={color} strokeWidth="2" />
              {!p.joinable && (
                <path
                  d={`M ${end.x - 3} ${end.y - 3} L ${end.x + 3} ${end.y + 3} M ${end.x + 3} ${end.y - 3} L ${end.x - 3} ${end.y + 3}`}
                  stroke={color} strokeWidth="1.75" strokeLinecap="round"
                />
              )}
            </g>
          )
        })}

        {/* confirmed legs */}
        {members.map(m => {
          const dest = byId.get(m.destinationId)
          if (!dest) return null
          const end = polar(dest.bearing, dest.r, C, C)
          const color = riderColor(m.colorIndex)
          return (
            <g key={m.key}>
              <line
                x1={C} y1={C} x2={end.x} y2={end.y}
                stroke={color} strokeWidth="3.25" strokeLinecap="round"
                className="animate-draw" style={{ ['--len' as string]: `${dest.r}` }}
                filter={`url(#${uid}-glow)`}
              />
              <circle cx={end.x} cy={end.y} r="9" fill={color} stroke="var(--paper)" strokeWidth="2.5" />
            </g>
          )
        })}

        {/* the selected destination while booking */}
        {selectedId && !members.some(m => m.destinationId === selectedId) && (() => {
          const dest = byId.get(selectedId)
          if (!dest || dest.zone.id === originId) return null
          const end = polar(dest.bearing, dest.r, C, C)
          return (
            <g key={`sel-${selectedId}`}>
              <line
                x1={C} y1={C} x2={end.x} y2={end.y}
                stroke="var(--signal)" strokeWidth="3.25" strokeLinecap="round"
                className="animate-draw" style={{ ['--len' as string]: `${dest.r}` }}
              />
              <circle cx={end.x} cy={end.y} r="9" fill="var(--signal)" stroke="var(--paper)" strokeWidth="2.5" />
            </g>
          )
        })()}

        {/* zones */}
        {[...byId.values()].map(({ zone, bearing, r }) => {
          if (zone.id === originId) return null
          const p = polar(bearing, r, C, C)
          const labelAt = labels.get(zone.id)!
          const anchor = labelAt.anchor
          const isHot = occupied.has(zone.id)
          const clickable = Boolean(onZoneClick)
          const isSelected = zone.id === selectedId

          const body = (
            <>
              {!isHot && (
                <circle
                  cx={p.x} cy={p.y} r={clickable ? 5.5 : 4}
                  fill="var(--surface)"
                  stroke="var(--ink-3)"
                  strokeWidth="1.5"
                  className={clickable ? 'transition-all group-hover:fill-[var(--signal)] group-hover:stroke-[var(--signal)]' : ''}
                />
              )}
              <text
                x={labelAt.x}
                y={labelAt.y}
                textAnchor={anchor}
                fontSize="11"
                fontWeight={isHot ? 700 : 500}
                className={`font-display ${isSelected ? 'fill-signal' : isHot ? 'fill-ink' : 'fill-ink-2'} ${clickable ? 'group-hover:fill-signal' : ''}`}
                style={{ paintOrder: 'stroke', stroke: 'var(--paper)', strokeWidth: 3.5, strokeLinejoin: 'round' }}
              >
                {zone.name}
              </text>
            </>
          )

          if (!clickable) return <g key={zone.id}>{body}</g>

          return (
            <g
              key={zone.id}
              role="button"
              tabIndex={0}
              aria-label={`Go to ${zone.name}, ${compassPoint(bearing)}`}
              aria-pressed={isSelected}
              className="group cursor-pointer outline-none"
              onClick={() => onZoneClick?.(zone.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onZoneClick?.(zone.id)
                }
              }}
            >
              {/* generous invisible hit area */}
              <circle cx={p.x} cy={p.y} r="16" fill="transparent" />
              {body}
            </g>
          )
        })}

        {/* Bullet, at the pickup */}
        <g>
          <circle cx={C} cy={C} r="12" fill="var(--signal)" fillOpacity="0.35" className="animate-ping-soft" />
          <circle cx={C} cy={C} r="11" fill="var(--ink)" stroke="var(--signal)" strokeWidth="2.5" />
          <circle cx={C} cy={C} r="3.5" fill="var(--marigold)" />
          <text
            x={originLabel.x} y={originLabel.y} textAnchor={originLabel.anchor} fontSize="11.5" fontWeight="800"
            className="fill-ink font-display"
            style={{ paintOrder: 'stroke', stroke: 'var(--paper)', strokeWidth: 4, strokeLinejoin: 'round' }}
          >
            {origin.name}
          </text>
        </g>
      </svg>
    </figure>
  )
}

type Anchor = 'start' | 'middle' | 'end'
interface LabelSpot { x: number; y: number; anchor: Anchor; w: number }

// Measured: Bricolage at 11px runs up to ~6.7px a character, and the paper-coloured
// halo stroke adds ~2px round every glyph. The box errs slightly large on purpose.
const CHAR_W = 7
const HALO = 2
const box = (l: LabelSpot) => {
  const left = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - l.w : l.x - l.w / 2
  return { left: left - HALO, right: left + l.w + HALO, top: l.y - 10.5, bottom: l.y + 3.5 }
}
const hits = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

function coversDot(b: ReturnType<typeof box>, dot: { x: number; y: number; r: number }) {
  const nx = Math.max(b.left, Math.min(dot.x, b.right))
  const ny = Math.max(b.top, Math.min(dot.y, b.bottom))
  return (nx - dot.x) ** 2 + (ny - dot.y) ** 2 < dot.r ** 2
}

type Box = ReturnType<typeof box>
interface Dot { id: number; x: number; y: number; r: number }
interface PlacedZone { zone: Zone; km: number; bearing: number; r: number }

const CENTRE_ID = -1

/** Pick the cheapest candidate: the first clear one, or else the least-bad. */
function choose<T>(candidates: T[], cost: (c: T) => number): { pick: T; cost: number } {
  let pick = candidates[0]
  let best = Infinity
  for (const c of candidates) {
    const k = cost(c)
    if (k < best) { pick = c; best = k }
    if (k === 0) break
  }
  return { pick, cost: best }
}

/**
 * Lays out every label for one distance curve and scores the clutter. Dots never
 * move — only text does, so the geometry stays honest. Each label takes the first
 * of a few candidate spots that is clear of every dot and every label already
 * placed; the pickup's own label goes first, then zones nearest the crowded
 * centre, then the ring distances.
 */
function placeAll(others: PlacedZone[], originName: string, rings: { km: number; r: number }[]) {
  const dots: Dot[] = others.map(p => ({ id: p.zone.id, ...polar(p.bearing, p.r, C, C), r: 7.5 }))
  dots.push({ id: CENTRE_ID, x: C, y: C, r: 15 })

  const placed: Box[] = []
  let clutter = 0
  const penalty = (b: Box, ownId: number) => {
    let k = 0
    for (const d of dots) if (d.id !== ownId && coversDot(b, d)) k += 10
    for (const p of placed) if (hits(b, p)) k += 5
    return k
  }

  // The pickup's name sits beside Bullet — below by preference.
  const ow = originName.length * CHAR_W * 1.1
  const origin = choose<LabelSpot>(
    [
      { x: C, y: C + 29, anchor: 'middle', w: ow },
      { x: C, y: C - 19, anchor: 'middle', w: ow },
      { x: C + 19, y: C + 4, anchor: 'start', w: ow },
      { x: C - 19, y: C + 4, anchor: 'end', w: ow },
    ],
    s => penalty(box(s), CENTRE_ID),
  )
  placed.push(box(origin.pick))
  clutter += origin.cost

  const labels = new Map<number, LabelSpot>()
  for (const p of [...others].sort((a, b) => a.r - b.r)) {
    const w = p.zone.name.length * CHAR_W
    const dot = polar(p.bearing, p.r, C, C)
    const out = (dist: number): LabelSpot => {
      const at = polar(p.bearing, p.r + dist, C, C)
      const anchor: Anchor = Math.abs(at.x - C) < 18 ? 'middle' : at.x > C ? 'start' : 'end'
      return { x: at.x, y: at.y + 3.5, anchor, w }
    }
    const beyond = out(15)
    const chosen = choose<LabelSpot>(
      [
        beyond,
        { x: dot.x + 10, y: dot.y + 4, anchor: 'start', w },
        { x: dot.x - 10, y: dot.y + 4, anchor: 'end', w },
        { x: dot.x, y: dot.y - 11, anchor: 'middle', w },
        { x: dot.x, y: dot.y + 19, anchor: 'middle', w },
        { ...beyond, y: beyond.y - 14 },
        { ...beyond, y: beyond.y + 14 },
        { x: dot.x + 10, y: dot.y - 9, anchor: 'start', w },
        { x: dot.x - 10, y: dot.y - 9, anchor: 'end', w },
        { x: dot.x + 10, y: dot.y + 17, anchor: 'start', w },
        { x: dot.x - 10, y: dot.y + 17, anchor: 'end', w },
        out(27),
      ],
      s => penalty(box(s), p.zone.id),
    )
    labels.set(p.zone.id, chosen.pick)
    placed.push(box(chosen.pick))
    clutter += chosen.cost
  }

  // Ring distances are a nicety: a ring with no clear spot goes unlabelled.
  const ringLabels = rings.map(({ km, r }) => {
    const text = `${km} km`
    for (const bearing of [22, 338, 158, 202, 68, 292, 112, 248]) {
      const p = polar(bearing, r, C, C)
      const at = { x: p.x + 3, y: p.y - 3 }
      const b = { left: at.x - 1, right: at.x + text.length * 5.4 + 1, top: at.y - 8, bottom: at.y + 2 }
      if (penalty(b, CENTRE_ID - 1) === 0) {
        placed.push(b)
        return { km, label: at }
      }
    }
    clutter += 1
    return { km, label: null as { x: number; y: number } | null }
  })

  return { labels, originLabel: origin.pick, ringLabels, clutter }
}

/**
 * Bearings are always exact; only the distance curve adapts. From Banani the
 * neighbours crowd the centre and a square-root curve spreads them; from Uttara
 * the whole city lies far to the south and a flatter curve spreads that cluster
 * instead. Each curve is laid out in full and the least cluttered one wins.
 */
function computeLayout(zones: Zone[], origin: Zone) {
  const measured = zones.map(z => ({
    zone: z,
    km: z.id === origin.id ? 0 : haversineKm(origin, z),
    bearing: z.id === origin.id ? 0 : bearingDeg(origin, z),
  }))
  const maxKm = Math.max(3, ...measured.map(m => m.km)) * 1.1
  const ringKm = RING_KM.filter(k => k < maxKm * 0.92)

  let best: ReturnType<typeof tryCurve> | null = null
  function tryCurve(exponent: number) {
    const radius = (km: number) => R * (km / maxKm) ** exponent
    const withR: PlacedZone[] = measured.map(m => ({ ...m, r: radius(m.km) }))
    const others = withR.filter(p => p.zone.id !== origin.id)
    const placed = placeAll(others, origin.name, ringKm.map(km => ({ km, r: radius(km) })))
    return {
      radius,
      byId: new Map(withR.map(p => [p.zone.id, p])),
      rings: placed.ringLabels,
      labels: placed.labels,
      originLabel: placed.originLabel,
      clutter: placed.clutter,
    }
  }

  for (const exponent of [0.5, 0.7, 1]) {
    const attempt = tryCurve(exponent)
    if (!best || attempt.clutter < best.clutter) best = attempt
    if (best.clutter === 0) break
  }
  return best!
}

function describe(
  originName: string,
  members: RadarMember[],
  proposals: RadarProposal[],
  byId: Map<number, { zone: Zone; bearing: number; km: number }>,
  arc: { start: number; sweep: number } | null,
): string {
  const parts = [`Centred on ${originName}.`]
  for (const m of members) {
    const d = byId.get(m.destinationId)
    if (d) parts.push(`${m.label} heading ${compassPoint(d.bearing)} to ${d.zone.name}.`)
  }
  for (const p of proposals) {
    const d = byId.get(p.destinationId)
    if (d) parts.push(`${p.label} wants ${d.zone.name} (${compassPoint(d.bearing)}), ${p.joinable ? 'fits' : 'does not fit'} the route.`)
  }
  if (arc) {
    parts.push(`Open heading ${Math.round(arc.start)}° to ${Math.round((arc.start + arc.sweep) % 360)}°.`)
  }
  return parts.join(' ')
}
