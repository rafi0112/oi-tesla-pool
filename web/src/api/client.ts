import type {
  DriverPool, DriverProfile, DriverRequest, PassengerRide, PassengerProfile,
  Quote, RideEvent, User, Zone, PoolOption, JoinAttempt,
} from './types'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

/** Every failure the API can return, carrying the contract's error code. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

let token: string | null = null
let onUnauthorized: (() => void) | null = null

export function setToken(next: string | null) {
  token = next
}

/** Called when a signed-in request comes back 401 — the token has expired. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  query?: Record<string, string | number>
  headers?: Record<string, string>
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const qs = opts.query
    ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)]))}`
    : ''

  let res: Response
  try {
    res = await fetch(`${BASE}${path}${qs}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Can’t reach the server. Is the API running?')
  }

  const text = await res.text()
  const data = text ? parseJson(text) : null

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error
    if (res.status === 401 && token) onUnauthorized?.()
    throw new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? res.statusText,
      err?.details ?? {},
    )
  }

  return data as T
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request<{ user: User }>('/auth/me'),

  zones: () => request<{ zones: Zone[] }>('/zones'),
  quote: (body: { pickupZoneId: number; destinationZoneId: number; seats: number }) =>
    request<Quote>('/rides/quote', { method: 'POST', body }),

  myRides: () => request<{ rides: PassengerRide[] }>('/rides/mine'),
  ride: (id: string) => request<{ ride: PassengerRide; timeline: RideEvent[] }>(`/rides/${id}`),
  nearbyPools: (query: { pickupZoneId: number; destinationZoneId: number; seats: number }) =>
    request<{ pools: PoolOption[] }>('/pools/nearby', { query }),
  bookRide: (
    body: {
      pickupZoneId: number; destinationZoneId: number; seats: number
      waitMinutes?: number; bonusPaisa?: number; poolId?: string
    },
    idempotencyKey: string,
  ) =>
    request<{ ride: PassengerRide; joinAttempt?: JoinAttempt }>('/rides', {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  cancelRide: (id: string) => request<{ ride: PassengerRide }>(`/rides/${id}/cancel`, { method: 'POST' }),
  submitFeedback: (id: string, body: { rating: number; comment?: string }) =>
    request<{ ride: PassengerRide }>(`/rides/${id}/feedback`, { method: 'POST', body }),

  passengerProfile: () => request<{ passenger: PassengerProfile }>('/passengers/me'),
  setPassengerLocation: (zoneId: number) =>
    request<{ passenger: PassengerProfile }>('/passengers/me', { method: 'PATCH', body: { zoneId } }),

  driverProfile: () => request<{ driver: DriverProfile }>('/drivers/me'),
  setAvailability: (body: { isOnline: boolean; zoneId?: number }) =>
    request<{ driver: DriverProfile }>('/drivers/me', { method: 'PATCH', body }),
  requestFeed: () => request<{ requests: DriverRequest[] }>('/drivers/requests'),
  driverHistory: () => request<{ pools: DriverPool[] }>('/drivers/history'),
  activePool: () => request<{ pool: DriverPool | null }>('/pools/active'),
  createPool: (rideRequestId: string) =>
    request<{ pool: DriverPool }>('/pools', { method: 'POST', body: { rideRequestId } }),
  joinPool: (poolId: string, rideRequestId: string) =>
    request<{ pool: DriverPool }>(`/pools/${poolId}/rides`, { method: 'POST', body: { rideRequestId } }),
  poolAction: (poolId: string, action: 'close' | 'arrive' | 'start' | 'complete') =>
    request<{ pool: DriverPool }>(`/pools/${poolId}/${action}`, { method: 'POST' }),
  dropOff: (poolId: string, rideId: string) =>
    request<{ pool: DriverPool }>(`/pools/${poolId}/rides/${rideId}/dropoff`, { method: 'POST' }),
}
