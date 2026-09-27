import { riderColor } from './riderColors'

export interface SeatOccupant {
  seats: number
  /** Index into the rider palette, or 'self' for the signal colour. */
  color: number | 'self'
  label?: string
}

interface Props {
  capacity: number
  occupants: SeatOccupant[]
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * Bullet's seats as physical seats. A multi-seat booking fills several in one
 * colour — the same colour that booking's route line wears on the radar.
 */
export function SeatPips({ capacity, occupants, size = 'md', className = '' }: Props) {
  const fills: (string | null)[] = []
  const labels: (string | undefined)[] = []
  for (const o of occupants) {
    for (let i = 0; i < o.seats; i++) {
      fills.push(o.color === 'self' ? 'var(--signal)' : riderColor(o.color))
      labels.push(o.label)
    }
  }
  while (fills.length < capacity) {
    fills.push(null)
    labels.push(undefined)
  }

  const taken = occupants.reduce((n, o) => n + o.seats, 0)
  const w = { sm: 20, md: 28, lg: 38 }[size]

  return (
    <div
      className={`flex items-end gap-1.5 ${className}`}
      role="img"
      aria-label={`${taken} of ${capacity} seats taken`}
    >
      {fills.slice(0, capacity).map((fill, i) => (
        <svg
          key={i}
          width={w}
          height={w * 1.1}
          viewBox="0 0 28 31"
          className="transition-transform duration-300"
          style={{ transitionDelay: `${i * 60}ms` }}
        >
          {labels[i] && <title>{labels[i]}</title>}
          <rect
            x="4.5" y="1.5" width="19" height="17" rx="6"
            fill={fill ?? 'transparent'}
            stroke={fill ?? 'var(--line-2)'}
            strokeWidth="1.5"
            strokeDasharray={fill ? undefined : '3 2.5'}
          />
          <rect
            x="1.5" y="15.5" width="25" height="10" rx="4.5"
            fill={fill ?? 'var(--surface)'}
            stroke={fill ?? 'var(--line-2)'}
            strokeWidth="1.5"
            strokeDasharray={fill ? undefined : '3 2.5'}
          />
          {fill && <rect x="8" y="5" width="12" height="2.5" rx="1.25" fill="white" fillOpacity="0.35" />}
          <rect x="5" y="25.5" width="3" height="4.5" rx="1" fill={fill ?? 'var(--line-2)'} />
          <rect x="20" y="25.5" width="3" height="4.5" rx="1" fill={fill ?? 'var(--line-2)'} />
        </svg>
      ))}
    </div>
  )
}
