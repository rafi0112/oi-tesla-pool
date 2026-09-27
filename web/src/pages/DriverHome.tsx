import { useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { DriverPool, DriverRequest, PoolStatus, Zone } from '../api/types'
import { useAuth } from '../context/AuthContext'
import { AppHeader, Avatar } from '../components/Chrome'
import { RouteRadar, type RadarMember, type RadarProposal } from '../components/RouteRadar'
import { SeatPips, type SeatOccupant } from '../components/SeatPips'
import { StatusTrack } from '../components/StatusTrack'
import { EmptyState, ErrorState, LoadingState, Notice, Skeleton, Spinner, StaleBadge } from '../components/States'
import { riderColor } from '../components/riderColors'
import { POLL_MS, useNow, useResource } from '../lib/useResource'
import { POOL_STATUS_LABEL, firstName, plural, relativeTime } from '../lib/format'
import { POOL_WINDOW_MINUTES } from '../lib/policy'

const TRIP_STEPS = [
  { key: 'FORMING',        label: 'Forming' },
  { key: 'ACCEPTED',       label: 'Ready' },
  { key: 'DRIVER_ARRIVED', label: 'At pickup' },
  { key: 'EN_ROUTE',       label: 'En route' },
  { key: 'COMPLETED',      label: 'Done' },
]

export function DriverHome() {
  const { user } = useAuth()
  const [banner, setBanner] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  const zones = useResource(() => api.zones().then(r => r.zones))
  const profile = useResource(() => api.driverProfile().then(r => r.driver))
  const online = profile.data?.isOnline === true

  const pool = useResource(() => api.activePool().then(r => r.pool), { pollMs: POLL_MS, enabled: online })
  const feed = useResource(() => api.requestFeed().then(r => r.requests), { pollMs: POLL_MS, enabled: online })

  async function refresh() {
    await Promise.all([pool.reload(), feed.reload()])
  }

  // Any refused action surfaces here with the API's own wording.
  async function run(action: () => Promise<unknown>, success?: string) {
    setBanner(null)
    try {
      await action()
      await refresh()
      if (success) setBanner({ tone: 'success', text: success })
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof ApiError ? err.message : 'That didn’t work' })
    }
  }

  return (
    <div className="theme-console grain min-h-dvh bg-paper text-ink">
      <AppHeader sub="Driver console">
        <div className="flex justify-end sm:justify-start sm:pl-4">
          <StaleBadge stale={pool.stale || feed.stale} />
        </div>
      </AppHeader>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
        <div className="animate-rise">
          <p className="eyebrow">Good day, {user ? firstName(user.name) : ''}</p>
          <h1 className="mt-2 text-4xl font-extrabold leading-[1.02] tracking-[-0.04em] sm:text-5xl">
            {!online
              ? 'You’re offline.'
              : pool.data
                ? `${plural(pool.data.passengers.length, 'passenger')} aboard.`
                : 'Waiting for riders.'}
          </h1>
        </div>

        <div className="mt-7">
          {profile.loading ? (
            <Skeleton className="h-24" />
          ) : profile.error ? (
            <div className="card"><ErrorState error={profile.error} onRetry={profile.reload} /></div>
          ) : profile.data && zones.data ? (
            <AvailabilityBar
              zones={zones.data}
              isOnline={profile.data.isOnline}
              zoneId={profile.data.currentZone?.id ?? null}
              vehicle={profile.data.vehicle}
              locked={Boolean(pool.data)}
              onChange={async (isOnline, zoneId) => {
                await run(() => api.setAvailability(isOnline ? { isOnline, zoneId: zoneId! } : { isOnline }))
                await profile.reload()
              }}
            />
          ) : null}
        </div>

        {banner && (
          <div className="mt-4">
            <Notice tone={banner.tone} onDismiss={() => setBanner(null)}>{banner.text}</Notice>
          </div>
        )}

        {!online ? (
          <OfflineState />
        ) : (
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-12">
            <section className="lg:col-span-7" aria-label="Active pool">
              {pool.loading ? (
                <div className="card"><LoadingState label="Loading your pool" /></div>
              ) : pool.error ? (
                <div className="card"><ErrorState error={pool.error} onRetry={pool.reload} /></div>
              ) : pool.data && zones.data ? (
                <ActivePool pool={pool.data} zones={zones.data} feed={feed.data ?? []} run={run} />
              ) : (
                <div className="card">
                  <EmptyState
                    title="No pool yet"
                    icon={<BulletMark />}
                  >
                    Accept a request and Bullet’s pool opens here.
                  </EmptyState>
                </div>
              )}
            </section>

            <section className="lg:col-span-5" aria-label="Open requests">
              <RequestFeed
                requests={feed.data}
                loading={feed.loading}
                error={feed.error}
                onRetry={feed.reload}
                hasPool={Boolean(pool.data)}
                zoneName={profile.data?.currentZone?.name}
                run={run}
                poolId={pool.data?.id}
              />
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

/* ─────────────────────────────────────────────────────── availability ── */

function AvailabilityBar({
  zones, isOnline, zoneId, vehicle, locked, onChange,
}: {
  zones: Zone[]
  isOnline: boolean
  zoneId: number | null
  vehicle: { name: string; seatCapacity: number } | null
  locked: boolean
  onChange: (isOnline: boolean, zoneId: number | null) => Promise<void>
}) {
  const [choice, setChoice] = useState<number | null>(zoneId ?? zones.find(z => z.name === 'Banani')?.id ?? zones[0].id)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (zoneId !== null) setChoice(zoneId)
  }, [zoneId])

  async function toggle() {
    setBusy(true)
    await onChange(!isOnline, choice)
    setBusy(false)
  }

  return (
    <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <span
          className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full ${isOnline ? 'bg-signal-soft' : 'bg-surface-2'}`}
        >
          {isOnline && <span className="absolute inset-0 rounded-full bg-signal/40 animate-ping-soft" />}
          <span className={`relative h-3 w-3 rounded-full ${isOnline ? 'bg-signal' : 'bg-ink-3'}`} />
        </span>
        <div>
          <p className="text-lg font-extrabold tracking-tight">{isOnline ? 'Online' : 'Offline'}</p>
          <p className="text-sm text-ink-3">
            {vehicle ? `${vehicle.name} · ${vehicle.seatCapacity} seats` : 'No vehicle registered'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2.5">
          <span className="eyebrow shrink-0">Zone</span>
          <span className="relative block">
            <select
              className="field appearance-none py-2.5 pr-9 font-semibold disabled:opacity-50"
              value={choice ?? ''}
              disabled={locked}
              title={locked ? 'Finish the trip before changing zone' : undefined}
              onChange={e => setChoice(Number(e.target.value))}
            >
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </label>

        <button
          type="button"
          onClick={toggle}
          disabled={busy || locked || (!isOnline && choice === null)}
          className={isOnline ? 'btn-ghost' : 'btn-primary'}
          title={locked ? 'Finish the trip before going offline' : undefined}
        >
          {busy && <Spinner />}
          {isOnline ? 'Go offline' : 'Go online'}
        </button>
      </div>
    </div>
  )
}

function OfflineState() {
  return (
    <div className="card mt-6 px-6 py-16 text-center">
      <div className="mx-auto max-w-sm">
        <BulletMark className="mx-auto" />
        <h2 className="mt-5 text-2xl font-extrabold tracking-tight">Pick a zone to start driving</h2>
        <p className="mt-2 text-ink-3">
          You’ll only see riders waiting in the zone you choose, so every pickup is close by.
        </p>
      </div>
    </div>
  )
}

function BulletMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`h-14 w-14 text-ink-3 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="32" cy="32" r="21" strokeDasharray="4 5" opacity=".5" />
      <path d="M34 18 25 34h7l-1 12 10-16h-7z" fill="currentColor" stroke="none" opacity=".8" />
    </svg>
  )
}

/* ────────────────────────────────────────────────────────── the pool ── */

function ActivePool({
  pool, zones, feed, run,
}: {
  pool: DriverPool
  zones: Zone[]
  feed: DriverRequest[]
  run: (action: () => Promise<unknown>, success?: string) => Promise<void>
}) {
  const now = useNow(1000, pool.status === 'FORMING')

  const members: RadarMember[] = pool.passengers
    .filter(p => p.status !== 'CANCELLED')
    .map((p, i) => ({ key: p.rideId, label: firstName(p.name), destinationId: p.destinationZone.id, colorIndex: i }))

  // Only requests that could still join are worth drawing as proposals.
  const proposals: RadarProposal[] = pool.seatsAvailable > 0
    ? feed.slice(0, 4).map(r => ({
        key: r.rideId,
        label: firstName(r.passengerName),
        destinationId: r.destinationZone.id,
        joinable: r.joinable,
      }))
    : []

  const occupants: SeatOccupant[] = pool.passengers
    .filter(p => p.status !== 'CANCELLED')
    .map((p, i) => ({ seats: p.seats, color: i, label: p.name }))

  const allDropped = pool.passengers.length > 0 && pool.passengers.every(p => p.status === 'DROPPED_OFF')

  return (
    <article className="card animate-rise overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <StatusBadge status={pool.status} />
          {pool.status === 'FORMING' && (
            <WindowTimer createdAt={pool.createdAt} now={now} />
          )}
        </div>
        <div className="flex items-center gap-3">
          <SeatPips capacity={pool.seatCapacity} occupants={occupants} size="sm" />
          <span className="font-mono text-sm font-bold">
            {pool.seatCapacity - pool.seatsAvailable}<span className="text-ink-3">/{pool.seatCapacity}</span>
          </span>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <StatusTrack steps={TRIP_STEPS} current={pool.status} cancelled={pool.status === 'CANCELLED'} />
      </div>

      <div className="border-y border-line bg-surface-2/30 px-5 py-5 sm:px-6">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow">Route from {pool.originZone.name}</p>
          {proposals.length > 0 && <p className="text-xs text-ink-3">dashed = waiting</p>}
        </div>
        <RouteRadar
          zones={zones}
          originId={pool.originZone.id}
          members={members}
          proposals={proposals}
          sweeping={pool.status === 'FORMING'}
          className="mx-auto mt-3 max-w-[23rem]"
          title={`Pool route from ${pool.originZone.name}`}
        />
      </div>

      <ul className="divide-y divide-line">
        {pool.passengers.map((p, i) => (
          <li key={p.rideId} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
            <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: riderColor(i) }} aria-hidden />
            <Avatar name={p.name} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{p.name}</p>
              <p className="truncate text-sm text-ink-3">
                {p.pickupZone.name} → {p.destinationZone.name} · {plural(p.seats, 'seat')}
              </p>
            </div>
            <RideChip status={p.status} />
            {pool.status === 'EN_ROUTE' && p.status === 'PICKED_UP' && (
              <button
                type="button"
                className="btn-ghost !py-2 text-sm"
                onClick={() => void run(() => api.dropOff(pool.id, p.rideId), `${firstName(p.name)} dropped off`)}
              >
                Drop off
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2.5 border-t border-line px-5 py-4 sm:px-6">
        {pool.status === 'FORMING' && (
          <button type="button" className="btn-primary" onClick={() => void run(() => api.poolAction(pool.id, 'close'), 'Pool closed to new riders')}>
            Close pool
          </button>
        )}
        {pool.status === 'ACCEPTED' && (
          <button type="button" className="btn-primary" onClick={() => void run(() => api.poolAction(pool.id, 'arrive'), 'Marked as arrived')}>
            I’ve arrived
          </button>
        )}
        {pool.status === 'DRIVER_ARRIVED' && (
          <button type="button" className="btn-primary" onClick={() => void run(() => api.poolAction(pool.id, 'start'), 'Trip started — fares locked')}>
            Start trip
          </button>
        )}
        {pool.status === 'EN_ROUTE' && (
          <button
            type="button"
            className="btn-primary"
            disabled={!allDropped}
            title={allDropped ? undefined : 'Drop everyone off first'}
            onClick={() => void run(() => api.poolAction(pool.id, 'complete'), 'Trip completed')}
          >
            Complete trip
          </button>
        )}
        {pool.status === 'EN_ROUTE' && !allDropped && (
          <p className="self-center text-sm text-ink-3">Drop every passenger off to finish.</p>
        )}
      </div>
    </article>
  )
}

function WindowTimer({ createdAt, now }: { createdAt: string; now: number }) {
  const closesAt = new Date(createdAt).getTime() + POOL_WINDOW_MINUTES * 60_000
  const left = Math.max(0, closesAt - now)
  const mins = Math.floor(left / 60_000)
  const secs = Math.floor((left % 60_000) / 1000)
  const expired = left === 0

  return (
    <span
      className={`font-mono text-sm font-bold ${expired ? 'text-ink-3' : 'text-marigold'}`}
      title="Riders can join while this window is open"
    >
      {expired ? 'window closed' : `${mins}:${String(secs).padStart(2, '0')} to join`}
    </span>
  )
}

function StatusBadge({ status }: { status: PoolStatus }) {
  const live = status === 'FORMING' || status === 'EN_ROUTE'
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-signal-soft px-3 py-1.5 text-sm font-bold text-signal">
      {live && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inset-0 rounded-full bg-signal animate-ping-soft" />
          <span className="relative h-2 w-2 rounded-full bg-signal" />
        </span>
      )}
      {POOL_STATUS_LABEL[status]}
    </span>
  )
}

function RideChip({ status }: { status: string }) {
  const tone = status === 'DROPPED_OFF' ? 'bg-signal-soft text-signal'
    : status === 'PICKED_UP' ? 'bg-marigold-soft text-marigold-ink'
    : status === 'CANCELLED' ? 'bg-alert-soft text-alert'
    : 'bg-surface-2 text-ink-2'
  const label = status === 'MATCHED' ? 'Waiting' : status === 'PICKED_UP' ? 'Aboard' : status === 'DROPPED_OFF' ? 'Dropped' : 'Cancelled'
  return <span className={`rounded-md px-2 py-1 font-mono text-[0.62rem] font-bold uppercase tracking-wider ${tone}`}>{label}</span>
}

/* ──────────────────────────────────────────────────────── the feed ── */

function RequestFeed({
  requests, loading, error, onRetry, hasPool, zoneName, run, poolId,
}: {
  requests: DriverRequest[] | undefined
  loading: boolean
  error: ApiError | null
  onRetry: () => void
  hasPool: boolean
  zoneName?: string
  run: (action: () => Promise<unknown>, success?: string) => Promise<void>
  poolId?: string
}) {
  return (
    <div className="card animate-rise" style={{ animationDelay: '100ms' }}>
      <div className="flex items-baseline justify-between border-b border-line px-5 py-4">
        <h2 className="text-lg font-extrabold tracking-tight">
          Waiting {zoneName && <span className="text-ink-3">in {zoneName}</span>}
        </h2>
        {requests && requests.length > 0 && <span className="font-mono text-sm text-ink-3">{requests.length}</span>}
      </div>

      {loading ? (
        <div className="space-y-3 p-5">{[0, 1].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : !requests || requests.length === 0 ? (
        <EmptyState title="Nobody waiting" icon={<BulletMark />}>
          New requests in {zoneName ?? 'your zone'} appear here within seconds.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {requests.map(r => (
            <RequestRow key={r.rideId} request={r} hasPool={hasPool} poolId={poolId} run={run} />
          ))}
        </ul>
      )}
    </div>
  )
}

function RequestRow({
  request, hasPool, poolId, run,
}: {
  request: DriverRequest
  hasPool: boolean
  poolId?: string
  run: (action: () => Promise<unknown>, success?: string) => Promise<void>
}) {
  const [waitForPool, setWaitForPool] = useState(false)
  const [busy, setBusy] = useState(false)

  async function accept() {
    setBusy(true)
    await run(
      () => (hasPool && poolId
        ? api.joinPool(poolId, request.rideId)
        : api.createPool(request.rideId, waitForPool)),
      `${firstName(request.passengerName)} added`,
    )
    setBusy(false)
  }

  return (
    <li className="p-5">
      <div className="flex items-start gap-3">
        <Avatar name={request.passengerName} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{request.passengerName}</p>
          <p className="truncate text-sm text-ink-3">
            {request.pickupZone.name} → {request.destinationZone.name}
          </p>
          <p className="mt-0.5 font-mono text-[0.68rem] text-ink-3">
            {plural(request.seats, 'seat')} · {relativeTime(request.requestedAt)}
          </p>
        </div>
      </div>

      {!request.joinable && request.reason && (
        <p className="mt-3 rounded-lg border border-alert/30 bg-alert-soft px-3 py-2 text-sm font-medium text-alert">
          {request.reason}
        </p>
      )}

      {/* The wait question only applies to the passenger who opens the pool. */}
      {!hasPool && request.joinable && (
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-2/40 px-3 py-2.5">
          <input
            type="checkbox"
            checked={waitForPool}
            onChange={e => setWaitForPool(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--signal)]"
          />
          <span className="text-sm leading-snug">
            <span className="font-semibold">Wait for another passenger?</span>
            <span className="block text-ink-3">
              Keeps the pool open {POOL_WINDOW_MINUTES} minutes — both riders then pay 20% less.
            </span>
          </span>
        </label>
      )}

      <button
        type="button"
        onClick={accept}
        disabled={!request.joinable || busy}
        className="btn-primary mt-3 w-full"
      >
        {busy && <Spinner />}
        {busy ? 'Adding' : hasPool ? 'Add to pool' : 'Accept'}
      </button>
    </li>
  )
}
