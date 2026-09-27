export interface TrackStep {
  key: string
  label: string
}

interface Props {
  steps: TrackStep[]
  current: string
  cancelled?: boolean
  /** Clock time each station was reached, keyed by step. */
  times?: Record<string, string>
  className?: string
}

/**
 * A journey drawn as a transit line: stations passed are filled, the current one
 * pulses, the rest wait hollow. The status machine, rendered as a map.
 */
export function StatusTrack({ steps, current, cancelled = false, times, className = '' }: Props) {
  const at = steps.findIndex(s => s.key === current)
  const progress = cancelled || at < 0 ? 0 : at / (steps.length - 1)

  return (
    <ol
      className={`relative grid ${className}`}
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label="Journey progress"
    >
      {/* rail */}
      <div
        aria-hidden
        className="absolute top-[0.6875rem] h-[3px] rounded-full bg-line"
        style={{ left: `${50 / steps.length}%`, right: `${50 / steps.length}%` }}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)] ${cancelled ? 'bg-alert/50' : 'bg-signal'}`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {steps.map((step, i) => {
        const done = !cancelled && i < at
        const here = !cancelled && i === at
        return (
          <li
            key={step.key}
            className="relative flex flex-col items-center gap-2 text-center"
            aria-current={here ? 'step' : undefined}
          >
            <span className="relative grid h-6 w-6 place-items-center">
              {here && <span className="absolute inset-0 rounded-full bg-signal animate-ping-soft" />}
              <span
                className={[
                  'relative h-6 w-6 rounded-full border-[3px] transition-colors duration-500',
                  done && 'border-signal bg-signal',
                  here && 'border-signal bg-paper',
                  !done && !here && 'border-line-2 bg-paper',
                  cancelled && 'border-line-2 bg-paper',
                ].filter(Boolean).join(' ')}
              >
                {done && (
                  <svg viewBox="0 0 16 16" className="absolute inset-0 m-auto h-3 w-3 text-on-signal" fill="none" stroke="currentColor" strokeWidth="2.8">
                    <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {here && <span className="absolute inset-[5px] rounded-full bg-signal" />}
              </span>
            </span>
            <span
              className={`text-[0.72rem] leading-tight font-semibold sm:text-xs ${here ? 'text-ink' : done ? 'text-ink-2' : 'text-ink-3'}`}
            >
              {step.label}
            </span>
            {times?.[step.key] && (done || here) && (
              <span className="-mt-1 font-mono text-[0.62rem] text-ink-3">{times[step.key]}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
