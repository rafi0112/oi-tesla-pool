import { useState, type ReactNode } from 'react'
import { useAuth, type OAuthProvider } from '../context/AuthContext'
import { Spinner } from './States'

const PROVIDERS: { id: OAuthProvider; label: string; icon: ReactNode }[] = [
  {
    id: 'google',
    label: 'Google',
    icon: (
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
        <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2H10v3.79h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.99-4.33 2.99-7.31Z" />
        <path fill="#34A853" d="M10 20c2.7 0 4.96-.89 6.62-2.42l-3.23-2.5c-.9.6-2.05.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H1.06v2.59A10 10 0 0 0 10 20Z" />
        <path fill="#FBBC05" d="M4.41 11.9a5.99 5.99 0 0 1 0-3.8V5.51H1.06a10 10 0 0 0 0 8.98l3.35-2.6Z" />
        <path fill="#EA4335" d="M10 3.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.96 9.96 0 0 0 10 0 10 10 0 0 0 1.06 5.51L4.41 8.1C5.2 5.74 7.4 3.98 10 3.98Z" />
      </svg>
    ),
  },
  {
    id: 'linkedin_oidc',
    label: 'LinkedIn',
    icon: (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="#0A66C2" aria-hidden>
        <path d="M17.04 17.04h-2.9v-4.54c0-1.08-.02-2.47-1.5-2.47-1.51 0-1.74 1.18-1.74 2.4v4.61h-2.9V7.5h2.78v1.3h.04c.39-.73 1.33-1.5 2.74-1.5 2.93 0 3.48 1.93 3.48 4.44v5.3ZM4.4 6.2a1.68 1.68 0 1 1 0-3.36 1.68 1.68 0 0 1 0 3.36ZM5.85 17.04H2.95V7.5h2.9v9.54Z" />
      </svg>
    ),
  },
]

/** Google + LinkedIn sign-in, shared by Login and Register — either one leaves the page immediately for the provider's own consent screen. */
export function OAuthButtons() {
  const { loginWithOAuth } = useAuth()
  const [busy, setBusy] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function go(provider: OAuthProvider) {
    setBusy(provider)
    setError(null)
    try {
      await loginWithOAuth(provider)
      // No further state change here on success — the browser is navigating away.
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not start ${provider} sign-in`)
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => void go(p.id)}
            disabled={busy !== null}
            className="btn-ghost !py-2.5 gap-2 text-sm"
          >
            {busy === p.id ? <Spinner /> : p.icon}
            {p.label}
          </button>
        ))}
      </div>
      {error && <p className="text-center text-xs text-alert">{error}</p>}
    </div>
  )
}
