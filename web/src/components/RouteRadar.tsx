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

  const layout = useMemo(() => {
    if (!origin) return null

    const placed = zones.map(z => {
      const km = z.id === origin.id ? 0 : haversineKm(origin, z)
      const bearing = z.id === origin.id ? 0 : bearingDeg(origin, z)
      return { zone: z, km, bearing }
    })

    const maxKm = Math.max(3, ...placed.map(p => p.km)) * 1.1
    // Square-root radius: directions stay exact, while nearby zones get room to breathe.
    const radius = (km: number) => R * Math.sqrt(km / maxKm)

    const byId = new Map(placed.map(p => [p.zone.id, { ...p, r: radius(p.km) }]))
    const rings = RING_KM.filter(k => k < maxKm * 0.92)

    return { byId, radius, rings }
  }, [zones, origin])

  if (!origin || !layout) {
    return (
      <div className={`grid aspect-square place-items-center rounded-full border border-line ${className}`}>
        <span className="eyebrow">Choose a pickup zone</span>
      </div>
    )
  }

  const { byId, radius, rings } = layout
  const memberBearings = members
    .map(m => byId.get(m.destinationId)?.bearing)
    .filter((b): b is number => b !== undefined)
  const arc = showOpenArc ? acceptableArc(memberBearings) : null

  const labels = placeLabels(
    [...byId.values()].filter(p => p.zone.id !== originId),
    { x: C, y: C + 29, text: origin.name },
  )

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
        {rings.map(km => {
          const r = radius(km)
          const label = polar(22, r, C, C)
          return (
            <g key={km}>
              <circle cx={C} cy={C} r={r} fill="none" stroke="var(--line-2)" strokeOpacity="0.55" strokeDasharray="2 5" />
              <text x={label.x + 3} y={label.y - 3} className="fill-ink-3 font-mono" fontSize="8.5">
                {km} km
              </text>
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
            x={C} y={C + 29} textAnchor="middle" fontSize="11.5" fontWeight="800"
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

const CHAR_W = 6.4
const box = (l: LabelSpot) => {
  const left = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - l.w : l.x - l.w / 2
  return { left, right: left + l.w, top: l.y - 10, bottom: l.y + 3 }
}
const hits = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/**
 * Labels start just beyond their dot, along the bearing. Zones that sit on
 * nearly the same bearing (Dhanmondi and Farmgate, seen from Banani) would
 * collide, so overlapping labels are pushed apart vertically. Dots never move —
 * only the text does, so the geometry stays honest.
 */
function placeLabels(
  zones: { zone: Zone; bearing: number; r: number }[],
  fixed: { x: number; y: number; text: string },
): Map<number, LabelSpot> {
  const spots = zones.map(({ zone, bearing, r }) => {
    const at = polar(bearing, r + 15, C, C)
    const anchor: Anchor = Math.abs(at.x - C) < 18 ? 'middle' : at.x > C ? 'start' : 'end'
    return { id: zone.id, spot: { x: at.x, y: at.y + 3.5, anchor, w: zone.name.length * CHAR_W } }
  })
  const pinned: LabelSpot = { x: fixed.x, y: fixed.y, anchor: 'middle', w: fixed.text.length * CHAR_W * 1.05 }

  for (let pass = 0; pass < 40; pass++) {
    let moved = false
    for (let i = 0; i < spots.length; i++) {
      const a = spots[i].spot
      if (hits(box(a), box(pinned))) {
        a.y += a.y >= pinned.y ? 2 : -2
        moved = true
      }
      for (let j = i + 1; j < spots.length; j++) {
        const b = spots[j].spot
        const ba = box(a)
        const bb = box(b)
        if (!hits(ba, bb)) continue
        const push = (Math.min(ba.bottom - bb.top, bb.bottom - ba.top) + 1) / 2
        if (a.y <= b.y) { a.y -= push; b.y += push } else { a.y += push; b.y -= push }
        moved = true
      }
    }
    if (!moved) break
  }

  return new Map(spots.map(s => [s.id, s.spot]))
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
