import { useState } from 'react'

const STAR = (filled: boolean) => (
  <svg viewBox="0 0 20 20" className="h-full w-full" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <path d="M10 2.2l2.36 4.78 5.28.77-3.82 3.72.9 5.26L10 14.2l-4.72 2.53.9-5.26-3.82-3.72 5.28-.77z" strokeLinejoin="round" />
  </svg>
)

/** Read-only stars — for a rating that's already been given. */
export function StarDisplay({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-marigold" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} style={{ width: size, height: size }}>{STAR(n <= rating)}</span>
      ))}
    </span>
  )
}

/** Interactive star picker — for giving a new rating. */
export function StarPicker({ value, onChange, size = 22 }: { value: number; onChange: (n: number) => void; size?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value

  return (
    <span role="radiogroup" aria-label="Rating" className="inline-flex items-center gap-1 text-marigold">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onChange(n)}
          className="p-0.5 transition-transform hover:scale-110"
          style={{ width: size, height: size }}
        >
          {STAR(n <= shown)}
        </button>
      ))}
    </span>
  )
}
