import type { ReactNode } from 'react'
import { ApiError } from '../api/client'

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-4 py-16 text-ink-3">
      <div className="relative h-10 w-10">
        <span className="absolute inset-0 rounded-full border border-signal/40 animate-ping-soft" />
        <span className="absolute inset-[35%] rounded-full bg-signal" />
      </div>
      <span className="eyebrow">{label}…</span>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} aria-hidden />
}

export function ErrorState({
  error, onRetry, title = 'That didn’t load',
}: { error: ApiError | Error; onRetry?: () => void; title?: string }) {
  const code = error instanceof ApiError ? error.code : null
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-alert-soft text-alert">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9.25" />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-ink-2">{error.message}</p>
        {code && <p className="eyebrow mt-2">{code}</p>}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-ghost mt-1 !py-2 text-sm">
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  icon, title, children,
}: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 text-ink-3">{icon}</div>}
      <p className="font-semibold text-ink-2">{title}</p>
      {children && <div className="max-w-xs text-sm text-ink-3">{children}</div>}
    </div>
  )
}

/** Shown when a background poll failed but the last good data is still on screen. */
export function StaleBadge({ stale }: { stale: boolean }) {
  if (!stale) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-marigold-soft px-2.5 py-1 font-mono text-[0.65rem] font-medium uppercase tracking-wider text-marigold-ink">
      <span className="h-1.5 w-1.5 rounded-full bg-marigold animate-blink" />
      Reconnecting
    </span>
  )
}

/** A dismissible banner for an action that was refused. */
export function Notice({
  tone, children, onDismiss,
}: { tone: 'error' | 'success' | 'info'; children: ReactNode; onDismiss?: () => void }) {
  const styles = {
    error:   'border-alert/30 bg-alert-soft text-alert',
    success: 'border-signal/30 bg-signal-soft text-signal',
    info:    'border-marigold/30 bg-marigold-soft text-marigold-ink',
  }[tone]

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`animate-rise flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${styles}`}
    >
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-0.5 rounded-md px-1.5 text-base leading-none opacity-70 hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  )
}
