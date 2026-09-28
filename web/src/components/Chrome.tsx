import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { homeFor, useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import type { Role } from '../api/types'
import { initials } from '../lib/format'
import { personColor } from './riderColors'
import { Logo } from './Logo'
import { LoadingState } from './States'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink ${className}`}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.55 1.55M18.25 18.25l1.55 1.55M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.55-1.55M18.25 5.75l1.55-1.55" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a7 7 0 0 0 10.8 10.8Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-display font-bold text-white ring-2 ring-paper"
      style={{ width: size, height: size, fontSize: size * 0.36, background: personColor(name) }}
    >
      {initials(name)}
    </span>
  )
}

export function AppHeader({ sub, children }: { sub: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
        <Logo size="sm" sub={sub} subHiddenOnMobile />
        <div className="min-w-0 flex-1">{children}</div>
        <UserMenu />
      </div>
    </header>
  )
}

/**
 * One compact control instead of a name, a role label, an avatar, a theme
 * toggle and a "Sign out" button all fighting for the same row — that's what
 * made the header crowd out "Driver console" into two lines on a phone. The
 * avatar alone is now the only thing that always shows; everything else lives
 * in the dropdown it opens, at any screen size.
 */
function UserMenu() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  if (!user) return null

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="grid place-items-center rounded-full transition-transform active:scale-95"
      >
        <Avatar name={user.name} />
      </button>

      {open && (
        <div
          role="menu"
          className="animate-rise absolute right-0 top-[calc(100%+0.5rem)] w-60 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_44px_-16px_rgb(0_0_0/0.35)]"
          style={{ animationDuration: '160ms' }}
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <Avatar name={user.name} size={38} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight text-ink">{user.name}</p>
              <p className="eyebrow mt-0.5 !text-[0.6rem]">{user.role === 'DRIVER' ? 'Driver' : 'Passenger'}</p>
            </div>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={toggle}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            <ThemeToggle className="pointer-events-none !h-6 !w-6" />
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className="flex w-full items-center px-4 py-3 text-sm font-semibold text-alert transition-colors hover:bg-alert-soft"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export function ProtectedRoute({ role, children }: { role: Role; children: ReactNode }) {
  const { user, restoring } = useAuth()

  if (restoring) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <LoadingState label="Checking your session" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  // An OAuth sign-in (Google/LinkedIn) has no role or vehicle yet — finish
  // that one-time step before anything role-gated is reachable.
  if (!user.profileCompleted) return <Navigate to="/complete-profile" replace />
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />
  return <>{children}</>
}

export function RootRedirect() {
  const { user, restoring } = useAuth()
  if (restoring) return null
  if (!user) return <Navigate to="/login" replace />
  if (!user.profileCompleted) return <Navigate to="/complete-profile" replace />
  return <Navigate to={homeFor(user.role)} replace />
}
