import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { homeFor, useAuth } from '../context/AuthContext'
import type { RegisterInput } from '../context/AuthContext'
import { ThemeToggle } from '../components/Chrome'
import { OAuthButtons } from '../components/OAuthButtons'
import { Notice, Spinner } from '../components/States'
import { StoryPanel } from './Login'

type Role = RegisterInput['role']
type Gender = RegisterInput['gender']

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: 'PASSENGER', label: 'Passenger', hint: 'Book rides' },
  { value: 'DRIVER',    label: 'Driver',    hint: 'Drive Bullet' },
]

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE',   label: 'Male' },
  { value: 'OTHER',  label: 'Other' },
]

export function Register() {
  const { user, restoring, register } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<Role>('PASSENGER')
  const [gender, setGender] = useState<Gender | null>(null)
  const [vehicleName, setVehicleName] = useState('')
  const [seatCapacity, setSeatCapacity] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!restoring && user) {
    return <Navigate to={user.profileCompleted ? homeFor(user.role) : '/complete-profile'} replace />
  }

  const passwordsMatch = password.length > 0 && password === confirmPassword
  const driverFieldsOk = role === 'PASSENGER' || vehicleName.trim().length > 0
  const ready =
    name.trim().length > 0 && email.trim().length > 0 &&
    password.length >= 8 && passwordsMatch && gender !== null && driverFieldsOk

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!ready || gender === null) return
    setBusy(true)
    setError(null)
    try {
      const signedUp = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        gender,
        ...(role === 'DRIVER' ? { vehicleName: vehicleName.trim(), seatCapacity } : {}),
      })
      navigate(homeFor(signedUp.role), { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <StoryPanel />

      <main className="grain relative flex items-center justify-center px-5 py-12 sm:px-10">
        <ThemeToggle className="absolute right-4 top-4 sm:right-6 sm:top-6" />
        <div className="w-full max-w-md animate-rise">
          <p className="eyebrow">Join Bullet</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.03em] text-ink">Create an account</h2>

          <div className="mt-6">
            <OAuthButtons />
          </div>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="eyebrow">or with email</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={onSubmit} className="space-y-3.5" noValidate>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink-2">Name</span>
              <input
                className="field" type="text" autoComplete="name" placeholder="Your full name"
                value={name} onChange={e => setName(e.target.value)} required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink-2">Email</span>
              <input
                className="field" type="email" autoComplete="email" placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)} required
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-ink-2">Password</span>
                <input
                  className="field" type="password" autoComplete="new-password" placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)} required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-ink-2">Confirm</span>
                <input
                  className="field" type="password" autoComplete="new-password" placeholder="••••••••"
                  value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required
                />
              </label>
            </div>
            {password.length > 0 && password.length < 8 && (
              <p className="-mt-2 text-xs text-alert">At least 8 characters.</p>
            )}
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="-mt-2 text-xs text-alert">Passwords don’t match.</p>
            )}

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
                    value={vehicleName} onChange={e => setVehicleName(e.target.value)} required={role === 'DRIVER'}
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
              {busy ? 'Creating account' : 'Create account'}
              {!busy && <span aria-hidden>→</span>}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-3">
            Already have an account? <Link to="/login" className="font-semibold text-ink hover:text-signal">Sign in</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
