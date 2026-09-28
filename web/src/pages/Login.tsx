import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { api } from '../api/client'
import { homeFor, useAuth } from '../context/AuthContext'
import { Logo } from '../components/Logo'
import { RouteRadar } from '../components/RouteRadar'
import { Rickshaw } from '../components/Rickshaw'
import { Avatar, ThemeToggle } from '../components/Chrome'
import { OAuthButtons } from '../components/OAuthButtons'
import { Notice, Spinner } from '../components/States'
import { useResource } from '../lib/useResource'
import { firstName } from '../lib/format'

const DEMO_PASSWORD = 'Password123!'

const CAST = [
  { name: 'Jashim Uddin', email: 'jashim@oitesla.test', role: 'Driver',    line: 'Drives Bullet · 3 seats' },
  { name: 'Nusrat Jahan', email: 'nusrat@oitesla.test', role: 'Passenger', line: 'Banani → Mohakhali' },
  { name: 'Rafiq Hasan',  email: 'rafiq@oitesla.test',  role: 'Passenger', line: 'Banani → Gulshan 1' },
  { name: 'Shirin Akter', email: 'shirin@oitesla.test', role: 'Passenger', line: 'Books from anywhere' },
]

export function Login() {
  const { user, restoring, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!restoring && user) {
    return <Navigate to={user.profileCompleted ? homeFor(user.role) : '/complete-profile'} replace />
  }

  async function signIn(nextEmail: string, nextPassword: string, who: string) {
    setError(null)
    setBusy(who)
    try {
      const signedIn = await login(nextEmail, nextPassword)
      navigate(signedIn.profileCompleted ? homeFor(signedIn.role) : '/complete-profile', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setBusy(null)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void signIn(email, password, 'form')
  }

  function boardAs(person: (typeof CAST)[number]) {
    setEmail(person.email)
    setPassword(DEMO_PASSWORD)
    void signIn(person.email, DEMO_PASSWORD, person.email)
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <StoryPanel />

      <main className="grain relative flex items-center justify-center px-5 py-12 sm:px-10">
        <ThemeToggle className="absolute right-4 top-4 sm:right-6 sm:top-6" />
        <div className="w-full max-w-md animate-rise">
          <p className="eyebrow">Welcome aboard</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.03em] text-ink">Sign in</h2>

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
              <span className="mb-1.5 block text-sm font-semibold text-ink-2">Email</span>
              <input
                className="field"
                type="email"
                autoComplete="email"
                placeholder="you@oitesla.test"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink-2">Password</span>
              <input
                className="field"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </label>

            {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}

            <button type="submit" className="btn-primary w-full !py-3.5" disabled={busy !== null || !email || !password}>
              {busy === 'form' ? <Spinner /> : null}
              {busy === 'form' ? 'Signing in' : 'Sign in'}
              {busy !== 'form' && <span aria-hidden>→</span>}
            </button>
          </form>

          <div className="my-8 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="eyebrow">or board as</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {CAST.map((person, i) => (
              <li key={person.email} className="animate-rise" style={{ animationDelay: `${120 + i * 70}ms` }}>
                <button
                  type="button"
                  onClick={() => boardAs(person)}
                  disabled={busy !== null}
                  className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-line-2 hover:shadow-[0_12px_28px_-18px_rgb(0_0_0/0.45)] disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  <Avatar name={person.name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold leading-tight text-ink">{firstName(person.name)}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span
                        className={`shrink-0 rounded px-1.5 py-px font-mono text-[0.56rem] font-bold uppercase tracking-wider ${
                          person.role === 'Driver' ? 'bg-ink text-paper' : 'bg-surface-2 text-ink-2'
                        }`}
                      >
                        {person.role}
                      </span>
                      <span className="truncate text-xs text-ink-3">{person.line}</span>
                    </span>
                  </span>
                  {busy === person.email
                    ? <Spinner className="text-signal" />
                    : <span aria-hidden className="text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-signal">→</span>}
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-center text-xs text-ink-3">
            Every demo account uses <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-ink-2">{DEMO_PASSWORD}</code>
          </p>

          <p className="mt-3 text-center text-sm text-ink-3">
            New here? <Link to="/register" className="font-semibold text-ink hover:text-signal">Create an account</Link>
          </p>
        </div>
      </main>
    </div>
  )
}

/** The pooling rule, demonstrated live on real zone data before anyone signs in. Also used by Register.tsx, for the same hero beside the sign-up form. */
export function StoryPanel() {
  const zones = useResource(() => api.zones().then(r => r.zones))

  const story = useMemo(() => {
    const list = zones.data
    if (!list) return null
    const by = (name: string) => list.find(z => z.name === name)
    const banani = by('Banani')
    const mohakhali = by('Mohakhali')
    const gulshan = by('Gulshan 1')
    const uttara = by('Uttara')
    if (!banani || !mohakhali || !gulshan || !uttara) return null

    return { list, banani, mohakhali, gulshan, uttara }
  }, [zones.data])

  return (
    <aside className="theme-console grain relative overflow-hidden bg-paper text-ink">
      {/* soft signal glow behind the radar */}
      <div aria-hidden className="pointer-events-none absolute -right-40 top-1/3 h-[34rem] w-[34rem] rounded-full bg-signal/10 blur-3xl" />
      <Rickshaw className="pointer-events-none absolute -bottom-3 -left-3 h-auto w-40 opacity-[0.14] sm:w-52" />

      <div className="relative flex h-full flex-col px-6 py-6 sm:px-12 sm:py-9 lg:py-10">
        <Logo size="md" sub="Dhaka · battery pooling" />

        <div className="mt-6 lg:mt-8">
          <h1 className="max-w-xl text-[2.2rem] font-extrabold leading-[0.98] tracking-[-0.045em] text-ink sm:text-5xl 2xl:text-6xl">
            One Bullet.<br />
            Three seats.<br />
            <span className="text-signal">Everyone going your way.</span>
          </h1>
          <p className="mt-5 max-w-md text-[1.02rem] leading-relaxed text-ink-2">
            Book alone, pay your own fare — and if someone heading the same direction
            hops in, you both pay <span className="font-bold text-marigold">20% less</span>.
          </p>
        </div>

        {story && (
          <div className="mt-6 hidden flex-1 flex-col items-start gap-5 lg:flex lg:mt-8 2xl:flex-row 2xl:items-center 2xl:gap-10">
            <RouteRadar
              zones={story.list}
              originId={story.banani.id}
              members={[
                { key: 'a', label: 'Rider A', destinationId: story.mohakhali.id, colorIndex: 0 },
                { key: 'b', label: 'Rider B', destinationId: story.gulshan.id, colorIndex: 1 },
              ]}
              proposals={[{ key: 'c', label: 'A third rider', destinationId: story.uttara.id, joinable: false }]}
              sweeping
              className="w-full max-w-[19rem] shrink-0 2xl:max-w-[24rem]"
              title="Pooling demonstration from Banani"
            />

            <div className="max-w-md space-y-2 2xl:max-w-[15rem]">
              <div className="flex items-start gap-3 rounded-xl border border-signal/25 bg-signal-soft/60 px-3.5 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-signal font-mono text-[0.65rem] font-extrabold text-on-signal">
                  90°
                </span>
                <p className="text-sm leading-snug text-ink-2">
                  Riders heading within <strong className="font-bold text-ink">90°</strong> of each other share one Bullet, automatically.
                </p>
              </div>
              <p className="pl-1 text-xs leading-relaxed text-ink-3">
                Past that, a request is simply declined — never detoured to fit.
              </p>
            </div>
          </div>
        )}

        <p className="mt-6 font-mono text-[0.68rem] uppercase tracking-[0.2em] text-ink-3 lg:mt-auto">
          ৳20 base · ৳10 / km · pooled −20%
        </p>
      </div>
    </aside>
  )
}
