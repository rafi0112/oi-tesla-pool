import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { api } from '../api/client'
import { homeFor, useAuth } from '../context/AuthContext'
import { ThemeToggle } from '../components/Chrome'
import { Notice, Spinner } from '../components/States'

type Role = 'PASSENGER' | 'DRIVER'
type Gender = 'MALE' | 'FEMALE' | 'OTHER'

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: 'PASSENGER', label: 'Passenger', hint: 'Book rides' },
  { value: 'DRIVER',    label: 'Driver',    hint: 'Drive Bullet' },
]

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE',   label: 'Male' },
  { value: 'OTHER',  label: 'Other' },
]

/**
 * The one-time step after a Google/LinkedIn sign-in — neither provider gives
 * a way to collect role, gender, or a driver's vehicle before the redirect,
 * so this fills in exactly what email/password signUp() would have asked for
 * up front. Skipped entirely for anyone whose profile is already complete.
 */
export function CompleteProfile() {
  const { user, restoring, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [role, setRole] = useState<Role>('PASSENGER')
  const [gender, setGender] = useState<Gender | null>(null)
  const [vehicleName, setVehicleName] = useState('')
  const [seatCapacity, setSeatCapacity] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!restoring && !user) return <Navigate to="/login" replace />
  if (!restoring && user?.profileCompleted) return <Navigate to={homeFor(user.role)} replace />

  const driverFieldsOk = role === 'PASSENGER' || vehicleName.trim().length > 0
  const ready = gender !== null && driverFieldsOk

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!ready || gender === null) return
    setBusy(true)
    setError(null)
    try {
      const { user: updated } = await api.completeProfile({
        role,
        gender,
        ...(role === 'DRIVER' ? { vehicleName: vehicleName.trim(), seatCapacity } : {}),
      })
      await refreshProfile()
      navigate(homeFor(updated.role), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile')
      setBusy(false)
    }
  }

  return (
    <div className="grain relative flex min-h-dvh items-center justify-center px-5 py-12 sm:px-10">
      <ThemeToggle className="absolute right-4 top-4 sm:right-6 sm:top-6" />
      <div className="w-full max-w-md animate-rise">
        <p className="eyebrow">One more step</p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.03em] text-ink">Finish setting up</h2>
        <p className="mt-2 text-sm text-ink-3">
          {user ? `Welcome, ${user.name.split(' ')[0]}` : 'Welcome'} — just need a couple of things your sign-in didn’t give us.
        </p>

        <form onSubmit={onSubmit} className="mt-7 space-y-3.5" noValidate>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-ink-2">I am a…</legend>
            <div role="radiogroup" aria-label="Role" className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={role === opt.value}
                  onClick={() => setRole(opt.value)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                    role === opt.value
                      ? 'border-signal bg-signal-soft text-signal'
                      : 'border-line-2 bg-surface-2 text-ink-2 hover:text-ink'
                  }`}
                >
                  <span className="block text-sm font-bold">{opt.label}</span>
                  <span className="block text-xs opacity-80">{opt.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-ink-2">Gender</legend>
            <div role="radiogroup" aria-label="Gender" className="inline-flex flex-wrap gap-1 rounded-xl border border-line-2 bg-surface-2 p-1">
              {GENDER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={gender === opt.value}
                  onClick={() => setGender(opt.value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-bold transition-all ${
                    gender === opt.value ? 'bg-ink text-paper shadow-sm' : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          {role === 'DRIVER' && (
            <div className="space-y-3.5 rounded-xl border border-line-2 bg-surface-2/50 p-3.5">
              <p className="eyebrow !text-[0.62rem]">Your vehicle</p>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-ink-2">Vehicle name</span>
                <input
                  className="field" type="text" placeholder="e.g. Comet"
                  value={vehicleName} onChange={e => setVehicleName(e.target.value)} required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-ink-2">Seats</span>
                <div role="radiogroup" aria-label="Seat capacity" className="inline-flex rounded-xl border border-line-2 bg-surface p-1">
                  {[1, 2, 3].map(n => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={seatCapacity === n}
                      onClick={() => setSeatCapacity(n)}
                      className={`h-9 w-11 rounded-lg font-mono text-sm font-bold transition-all ${
                        seatCapacity === n ? 'bg-ink text-paper shadow-sm' : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </label>
            </div>
          )}

          {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}

          <button type="submit" className="btn-primary w-full !py-3.5" disabled={!ready || busy}>
            {busy ? <Spinner /> : null}
            {busy ? 'Saving' : 'Continue'}
            {!busy && <span aria-hidden>→</span>}
          </button>
        </form>
      </div>
    </div>
  )
}
