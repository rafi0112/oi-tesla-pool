import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, api } from '../api/client'
import type { PassengerRide, RideStatus, Zone } from '../api/types'
import { useAuth } from '../context/AuthContext'
import { AppHeader, Avatar } from '../components/Chrome'
import { RouteRadar } from '../components/RouteRadar'
import { SeatPips } from '../components/SeatPips'
import { StatusTrack } from '../components/StatusTrack'
import {
  EmptyState, ErrorState, Notice, Skeleton, Spinner, StaleBadge,
} from '../components/States'
import { POLL_MS, useResource } from '../lib/useResource'
import { bearingDeg, compassPoint } from '../lib/geo'
import {
  clockTime, firstName, formatTaka, plural, RIDE_STATUS_LABEL, shortDate,
} from '../lib/format'

const ACTIVE: ReadonlySet<RideStatus> = new Set(['REQUESTED', 'MATCHED', 'PICKED_UP'])
const MAX_SEATS = 3

const JOURNEY = [
  { key: 'REQUESTED',   label: 'Requested' },
  { key: 'MATCHED',     label: 'Matched' },
  { key: 'PICKED_UP',   label: 'On board' },
  { key: 'DROPPED_OFF', label: 'Arrived' },
]

export function PassengerHome() {
  const { user } = useAuth()
  const zones = useResource(() => api.zones().then(r => r.zones))
  const rides = useResource(() => api.myRides().then(r => r.rides), { pollMs: POLL_MS })

  const active = rides.data?.find(r => ACTIVE.has(r.status))
  const past = useMemo(
    () => (rides.data ?? []).filter(r => r.status === 'DROPPED_OFF' || r.status === 'CANCELLED'),
    [rides.data],
  )

  const loading = rides.loading || zones.loading
  const failure = rides.error ?? zones.error

  return (
    <div className="grain min-h-dvh">
      <AppHeader sub="Passenger">
        <div className="flex justify-end sm:justify-start sm:pl-4">
          <StaleBadge stale={rides.stale} />
        </div>
      </AppHeader>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:pt-12">
        <Greeting name={user ? firstName(user.name) : ''} ride={active} />

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-12 lg:gap-8">
          <section className="lg:col-span-8" aria-label={active ? 'Your ride' : 'Book a ride'}>
            {loading ? (
              <TicketSkeleton />
            ) : failure ? (
              <div className="card">
                <ErrorState error={failure} onRetry={() => { void rides.reload(); void zones.reload() }} />
              </div>
            ) : active && zones.data ? (
              <RideTicket ride={active} zones={zones.data} onChanged={rides.reload} />
            ) : zones.data ? (
              <BookingTicket zones={zones.data} onBooked={rides.reload} />
            ) : null}
          </section>

          <aside className="lg:col-span-4">
            <PastRides rides={past} loading={rides.loading} />
          </aside>
        </div>
      </main>
    </div>
  )
}

function Greeting({ name, ride }: { name: string; ride?: PassengerRide }) {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  const line = !ride
    ? 'Where is Bullet taking you?'
    : ride.status === 'REQUESTED'
      ? `Looking for Bullet near ${ride.pickupZone.name}…`
      : ride.status === 'MATCHED'
        ? `${ride.driver ? firstName(ride.driver.name) : 'Your driver'} is on the way.`
        : `Enjoy the ride to ${ride.destinationZone.name}.`

  return (
    <div className="animate-rise">
      <p className="eyebrow">Good {part}, {name}</p>
      <h1 className="mt-2 max-w-3xl text-4xl font-extrabold leading-[1.02] tracking-[-0.04em] text-ink sm:text-5xl">
        {line}
      </h1>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────── booking ── */

function BookingTicket({ zones, onBooked }: { zones: Zone[]; onBooked: () => Promise<void> }) {
  const defaultPickup = zones.find(z => z.name === 'Banani')?.id ?? zones[0].id
  const [pickupId, setPickupId] = useState<number>(defaultPickup)
  const [destinationId, setDestinationId] = useState<number | null>(null)
  const [seats, setSeats] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One key per booking attempt: a network retry re-sends the same key, so the
  // server hands back the original ride instead of creating a second one.
  const idempotencyKey = useRef(crypto.randomUUID())

  const ready = destinationId !== null && destinationId !== pickupId
  const quote = useResource(
    () => api.quote({ pickupZoneId: pickupId, destinationZoneId: destinationId!, seats }),
    { enabled: ready, key: `${pickupId}-${destinationId}-${seats}` },
  )

  const pickup = zones.find(z => z.id === pickupId)
  const destination = zones.find(z => z.id === destinationId)
  const heading = pickup && destination ? bearingDeg(pickup, destination) : null

  function choosePickup(id: number) {
    setPickupId(id)
    if (id === destinationId) setDestinationId(null)
  }

  function chooseDestination(id: number) {
    if (id !== pickupId) setDestinationId(id)
  }

  async function book() {
    if (!ready) return
    setSubmitting(true)
    setError(null)
    try {
      await api.bookRide({ pickupZoneId: pickupId, destinationZoneId: destinationId!, seats }, idempotencyKey.current)
      idempotencyKey.current = crypto.randomUUID()
      await onBooked()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Booking failed')
      setSubmitting(false)
    }
  }

  const saving = quote.data ? quote.data.soloFarePaisa - quote.data.pooledFarePaisa : 0

  return (
    <article className="card relative animate-rise shadow-[0_30px_60px_-40px_rgb(60_40_10/0.45)]">
      <div className="grid md:grid-cols-[1fr_minmax(0,1.05fr)]">
        {/* trip */}
        <div className="space-y-6 p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <p className="eyebrow">New ride</p>
            <p className="font-mono text-[0.68rem] text-ink-3">BULLET · 3 SEATS</p>
          </div>

          <div className="relative space-y-3 pl-7">
            <span aria-hidden className="absolute left-[0.6rem] top-[1.9rem] bottom-[1.9rem] w-[2px] rounded-full bg-gradient-to-b from-ink-3/60 to-signal" />
            <ZoneField
              label="From"
              dotClass="bg-ink border-ink"
              value={pickupId}
              zones={zones}
              onChange={choosePickup}
            />
            <ZoneField
              label="To"
              dotClass="bg-signal border-signal"
              value={destinationId}
              zones={zones.filter(z => z.id !== pickupId)}
              onChange={chooseDestination}
              placeholder="Choose, or tap the map"
            />
          </div>

          <fieldset>
            <legend className="mb-2 flex w-full items-baseline justify-between">
              <span className="text-sm font-semibold text-ink-2">Seats</span>
              <span className="text-xs text-ink-3">still one fare</span>
            </legend>
            <div className="flex items-center gap-4">
              <div role="radiogroup" aria-label="Seats" className="inline-flex rounded-xl border border-line-2 bg-surface-2 p-1">
                {[1, 2, 3].map(n => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={seats === n}
                    onClick={() => setSeats(n)}
                    className={`h-9 w-11 rounded-lg font-mono text-sm font-bold transition-all ${
                      seats === n ? 'bg-ink text-paper shadow-sm' : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <SeatPips capacity={MAX_SEATS} occupants={[{ seats, color: 'self', label: 'Your booking' }]} size="sm" />
            </div>
            {seats > 1 && (
              <p className="mt-2.5 text-xs leading-relaxed text-ink-3">
                Bringing {seats - 1 === 1 ? 'someone' : `${seats - 1} people`}? Extra seats in one booking are free — you pay a single fare.
              </p>
            )}
          </fieldset>
        </div>

        {/* map */}
        <div className="border-t border-line bg-surface-2/40 p-5 sm:p-6 md:rounded-tr-[var(--radius-ticket)] md:border-l md:border-t-0">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Tap a destination</p>
            {heading !== null && (
              <p className="font-mono text-[0.7rem] font-bold text-signal">
                {compassPoint(heading)} · {Math.round(heading)}°
              </p>
            )}
          </div>
          <RouteRadar
            zones={zones}
            originId={pickupId}
            selectedId={destinationId}
            onZoneClick={chooseDestination}
            showOpenArc={false}
            className="mx-auto mt-3 max-w-[22rem]"
            title={`Zones around ${pickup?.name ?? 'your pickup'}`}
          />
        </div>
      </div>

      <div className="perforation" aria-hidden />

      {/* stub */}
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
        <div className="min-h-[4.5rem]">
          {!ready ? (
            <p className="max-w-xs text-sm text-ink-3">Pick where you’re going and your fare appears here.</p>
          ) : quote.loading ? (
            <div className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-9 w-40" /></div>
          ) : quote.error ? (
            <p className="text-sm text-alert">{quote.error.message}</p>
          ) : quote.data ? (
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <p className="eyebrow">Your fare</p>
                <p className="mt-1 font-mono text-4xl font-bold tracking-tight text-ink">
                  {formatTaka(quote.data.soloFarePaisa)}
                </p>
              </div>
              <div className="pb-1">
                <p className="eyebrow !text-marigold-ink">If someone joins</p>
                <p className="mt-1 font-mono text-xl font-bold text-marigold-ink">
                  {formatTaka(quote.data.pooledFarePaisa)}
                  <span className="ml-2 rounded-md bg-marigold-soft px-1.5 py-0.5 text-xs">−{formatTaka(saving)}</span>
                </p>
              </div>
              <p className="w-full font-mono text-xs text-ink-3 sm:w-auto sm:pb-2">
                {quote.data.distanceKm.toFixed(1)} km · {plural(seats, 'seat')}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}
          <button type="button" onClick={book} disabled={!ready || submitting} className="btn-primary !px-7 !py-4 text-base">
            {submitting ? <Spinner /> : null}
            {submitting ? 'Requesting' : 'Request Bullet'}
            {!submitting && <span aria-hidden>→</span>}
          </button>
        </div>
      </div>
    </article>
  )
}

function ZoneField({
  label, dotClass, value, zones, onChange, placeholder,
}: {
  label: string
  dotClass: string
  value: number | null
  zones: Zone[]
  onChange: (id: number) => void
  placeholder?: string
}) {
  return (
    <label className="relative block">
      <span aria-hidden className={`absolute -left-7 top-[1.9rem] h-3.5 w-3.5 rounded-full border-2 ring-4 ring-surface ${dotClass}`} />
      <span className="mb-1.5 block eyebrow">{label}</span>
      <span className="relative block">
        <select
          className="field appearance-none pr-10 font-semibold"
          value={value ?? ''}
          onChange={e => onChange(Number(e.target.value))}
        >
          {value === null && <option value="" disabled>{placeholder}</option>}
          {zones.map(z => (
            <option key={z.id} value={z.id}>{z.name}</option>
          ))}
        </select>
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </label>
  )
}

/* ────────────────────────────────────────────────────────────── ride ── */

function RideTicket({
  ride, zones, onChanged,
}: { ride: PassengerRide; zones: Zone[]; onChanged: () => Promise<void> }) {
  const detail = useResource(() => api.ride(ride.id), { pollMs: POLL_MS, key: ride.id })
  const distance = useResource(
    () => api.quote({
      pickupZoneId: ride.pickupZone.id, destinationZoneId: ride.destinationZone.id, seats: ride.seats,
    }).then(q => q.distanceKm),
    { key: ride.id },
  )

  // Prefer the freshest copy — the detail poll and the list poll race each other.
  const current = detail.data?.ride ?? ride

  const pickup = zones.find(z => z.id === current.pickupZone.id)
  const destination = zones.find(z => z.id === current.destinationZone.id)
  const heading = pickup && destination ? compassPoint(bearingDeg(pickup, destination)) : null

  const times = useMemo(() => {
    const out: Record<string, string> = { REQUESTED: clockTime(current.createdAt) }
    for (const e of detail.data?.timeline ?? []) out[e.toStatus] = clockTime(e.at)
    return out
  }, [current.createdAt, detail.data?.timeline])

  const discounted = current.farePaisa < current.quotedFarePaisa
  const locked = current.finalFarePaisa !== null

  return (
    <article className="card relative animate-rise shadow-[0_30px_60px_-40px_rgb(60_40_10/0.45)]">
      <div className="space-y-7 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow">Ride · <span className="text-ink-2">#{current.id.slice(0, 6).toUpperCase()}</span></p>
          <span className="inline-flex items-center gap-2 rounded-full bg-signal-soft px-3 py-1.5 text-sm font-bold text-signal">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-signal animate-ping-soft" />
              <span className="relative h-2 w-2 rounded-full bg-signal" />
            </span>
            {RIDE_STATUS_LABEL[current.status]}
          </span>
        </div>

        <RouteBar
          from={current.pickupZone.name}
          to={current.destinationZone.name}
          status={current.status}
          meta={[distance.data !== undefined ? `${distance.data.toFixed(1)} km` : null, heading].filter(Boolean).join(' · ')}
        />

        <StatusTrack steps={JOURNEY} current={current.status} times={times} className="pt-1" />

        <div className="grid gap-3 sm:grid-cols-3">
          <Detail label="Driver">
            {current.driver ? (
              <span className="flex items-center gap-2.5">
                <Avatar name={current.driver.name} size={30} />
                <span className="leading-tight">
                  <span className="block font-bold text-ink">{current.driver.name}</span>
                  <span className="block text-xs text-ink-3">in {current.driver.vehicle}</span>
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-2 text-ink-3">
                <Spinner className="text-signal" /> Waiting for a driver
              </span>
            )}
          </Detail>
          <Detail label="Sharing">
            {current.sharedWith > 0 ? (
              <span className="font-bold text-ink">
                Shared with {plural(current.sharedWith, 'other passenger')}
              </span>
            ) : (
              <span className="text-ink-3">Just you so far</span>
            )}
          </Detail>
          <Detail label="Seats">
            <span className="flex items-center gap-3">
              <SeatPips capacity={current.seats} occupants={[{ seats: current.seats, color: 'self' }]} size="sm" />
              <span className="font-bold text-ink">{current.seats}</span>
            </span>
          </Detail>
        </div>
      </div>

      <div className="perforation" aria-hidden />

      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="relative">
          <p className="eyebrow flex items-center gap-2">
            Your fare
            {locked && (
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-2">
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
                  <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5A1 1 0 0 1 13 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h.5zm1.5 0h4V5a2 2 0 1 0-4 0v2z" />
                </svg>
                Locked
              </span>
            )}
          </p>
          <div className="mt-1 flex items-baseline gap-3">
            <p className="font-mono text-5xl font-bold tracking-tight text-ink">{formatTaka(current.farePaisa)}</p>
            {discounted && (
              <p className="font-mono text-lg text-ink-3 line-through decoration-alert/70 decoration-2">
                {formatTaka(current.quotedFarePaisa)}
              </p>
            )}
          </div>
          <p className="mt-1.5 text-xs text-ink-3">
            {discounted
              ? `You save ${formatTaka(current.quotedFarePaisa - current.farePaisa)} by sharing`
              : current.sharedWith === 0 && !locked
                ? 'Drops 20% if someone going your way joins'
                : 'One fare for your whole booking'}
          </p>

          {discounted && (
            <span
              key="pooled-stamp"
              className="animate-stamp pointer-events-none absolute right-0 -top-5 rounded-lg border-[2.5px] border-marigold px-2.5 py-1 font-mono text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-marigold sm:-right-28 sm:top-2"
              style={{ transform: 'rotate(-8deg)' }}
            >
              Pooled −20%
            </span>
          )}
        </div>

        <CancelButton ride={current} onCancelled={onChanged} />
      </div>
    </article>
  )
}

function RouteBar({ from, to, status, meta }: { from: string; to: string; status: RideStatus; meta: string }) {
  const progress = status === 'DROPPED_OFF' ? 100 : status === 'PICKED_UP' ? 55 : 0
  const waiting = status === 'REQUESTED'

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Pickup</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{from}</p>
        </div>
        <div className="text-right">
          <p className="eyebrow">Destination</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{to}</p>
        </div>
      </div>

      <div className="relative mt-5 h-8" aria-hidden>
        <div className="absolute inset-x-2 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[repeating-linear-gradient(90deg,var(--line-2)_0_8px,transparent_8px_14px)]" />
        <div
          className="absolute left-2 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-signal transition-[width] duration-1000 ease-[var(--ease-out-expo)]"
          style={{ width: `calc((100% - 1rem) * ${progress / 100})` }}
        />
        <span className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-[3px] border-ink bg-paper" />
        <span className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-[3px] border-signal bg-signal" />
        <span
          className="absolute top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink shadow-[0_6px_16px_-6px_rgb(0_0_0/0.6)] transition-[left] duration-1000 ease-[var(--ease-out-expo)]"
          style={{ left: `calc(0.5rem + (100% - 1rem) * ${progress / 100})`, opacity: waiting ? 0.4 : 1 }}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-signal" fill="currentColor">
            <path d="M9.2 1 3 9h4.3l-.6 6L13 7H8.6z" />
          </svg>
        </span>
      </div>

      {meta && <p className="mt-2 text-center font-mono text-xs text-ink-3">{meta}</p>}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 px-4 py-3">
      <p className="eyebrow mb-1.5">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function CancelButton({ ride, onCancelled }: { ride: PassengerRide; onCancelled: () => Promise<void> }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Disarm after a moment so a stray second tap can't cancel by accident later.
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3500)
    return () => window.clearTimeout(t)
  }, [armed])

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await api.cancelRide(ride.id)
      await onCancelled()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel')
      setBusy(false)
      setArmed(false)
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}
      <button
        type="button"
        disabled={!ride.canCancel || busy}
        onClick={() => (armed ? void confirm() : setArmed(true))}
        className={armed ? 'btn !bg-alert !text-white' : 'btn-danger'}
        title={ride.canCancel ? undefined : 'You’re on board — cancelling closes once you’re picked up.'}
      >
        {busy && <Spinner />}
        {busy ? 'Cancelling' : armed ? 'Tap again to cancel' : 'Cancel ride'}
      </button>
      {!ride.canCancel && ride.status === 'PICKED_UP' && (
        <p className="text-xs text-ink-3 sm:text-right">You’re on board — no cancelling now.</p>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────── past ── */

function PastRides({ rides, loading }: { rides: PassengerRide[]; loading: boolean }) {
  return (
    <section className="card animate-rise p-5 sm:p-6" style={{ animationDelay: '120ms' }} aria-labelledby="past-title">
      <div className="flex items-baseline justify-between">
        <h2 id="past-title" className="text-lg font-extrabold tracking-tight text-ink">Past rides</h2>
        {rides.length > 0 && <span className="font-mono text-xs text-ink-3">{rides.length}</span>}
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-[4.5rem]" />)}
        </div>
      ) : rides.length === 0 ? (
        <EmptyState
          title="No past rides yet."
          icon={
            <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="7" y="13" width="34" height="22" rx="5" strokeDasharray="3 3" />
              <path d="M17 24h14M27 20l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        >
          Finished and cancelled trips collect here.
        </EmptyState>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {rides.map(r => {
            const done = r.status === 'DROPPED_OFF'
            const pooled = r.farePaisa < r.quotedFarePaisa
            return (
              <li key={r.id} className="rounded-xl border border-line bg-surface-2/35 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">
                      {r.pickupZone.name} <span className="text-ink-3">→</span> {r.destinationZone.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[0.68rem] text-ink-3">{shortDate(r.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono text-sm font-bold ${done ? 'text-ink' : 'text-ink-3 line-through'}`}>
                      {formatTaka(r.farePaisa)}
                    </p>
                    <p className={`mt-0.5 text-[0.68rem] font-bold uppercase tracking-wider ${done ? 'text-signal' : 'text-alert'}`}>
                      {done ? (pooled ? 'Arrived · pooled' : 'Arrived') : 'Cancelled'}
                    </p>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function TicketSkeleton() {
  return (
    <div className="card space-y-6 p-8" aria-busy="true" aria-label="Loading your ride">
      <Skeleton className="h-3 w-28" />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-10 w-40" />
        </div>
        <Skeleton className="aspect-square rounded-full" />
      </div>
      <Skeleton className="h-16" />
    </div>
  )
}
