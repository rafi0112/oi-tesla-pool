import type { ReactNode } from 'react'
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
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Logo size="sm" sub={sub} />
        <div className="flex-1">{children}</div>
        <ThemeToggle />
        {user && (
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight text-ink">{user.name}</p>
              <p className="eyebrow !text-[0.6rem]">{user.role === 'DRIVER' ? 'Driver' : 'Passenger'}</p>
            </div>
            <Avatar name={user.name} />
            <button
              type="button"
              onClick={logout}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
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
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />
  return <>{children}</>
}

export function RootRedirect() {
  const { user, restoring } = useAuth()
  if (restoring) return null
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />
}
