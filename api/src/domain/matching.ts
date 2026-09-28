export const POOL_POLICY = {
  detourCapKm:       3.0,
  // The most any single passenger may ask the pool to wait. Not a fixed window
  // any more — each passenger states their own patience (waitMinutes), and the
  // pool's actual deadline is the earliest of everyone who has joined so far.
  maxWaitMinutes:    10,
  maxBearingDiffDeg: 90,
  // Upper sanity bound for a booking — the binding limit is the vehicle's own
  // seat_capacity, checked at pool creation and again on every join.
  maxSeatsPerBooking: 3,
  // A REQUESTED ride nobody has matched within this long expires on its own —
  // see ride.service.ts's expireIfStale. The passenger is then free to book
  // again (assumption 7's one-active-ride limit no longer blocks them), this
  // time optionally with a bonus (FARE_POLICY.maxBonusPaisa) to attract a driver.
  requestExpiryMinutes: 15,
}

export interface Zone {
  id: number
  name: string
  lat: number
  lng: number
}

export interface PoolMember {
  rideId: string
  destinationZoneId: number
  seats: number
}

export interface PoolSnapshot {
  status: string
  seatsAvailable: number
  originZoneId: number
  // Null means the pool is not (or no longer) accepting new joins at all —
  // either nobody aboard asked to wait, or the driver closed it early. A
  // timestamp is the earliest deadline any current member has asked for; it
  // only ever moves earlier as passengers with shorter patience join in.
  waitUntil: Date | null
  members: PoolMember[]
}

export interface JoinCandidate {
  seats: number
  pickupZoneId: number
  destinationZoneId: number
}

export type DistanceMatrix = Map<string, number>

export interface JoinResult {
  ok: boolean
  reason?: string
}

export function distanceKey(fromZoneId: number, toZoneId: number): string {
  return `${fromZoneId}:${toZoneId}`
}

function distanceBetween(
  distances: DistanceMatrix,
  fromZoneId: number,
  toZoneId: number,
): number | undefined {
  if (fromZoneId === toZoneId) return 0
  return distances.get(distanceKey(fromZoneId, toZoneId))
}

export function bearingDeg(from: Zone, to: Zone): number {
  const dLng = (to.lng - from.lng) * Math.PI / 180
  const lat1 = from.lat * Math.PI / 180
  const lat2 = to.lat * Math.PI / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Greedy nearest-neighbour route: start at the origin, repeatedly hop to the
 * closest destination not yet visited. Returns undefined if any leg is missing
 * from the seeded matrix.
 */
export function pooledRouteKm(
  originZoneId: number,
  destinationZoneIds: number[],
  distances: DistanceMatrix,
): number | undefined {
  const unvisited = new Set(destinationZoneIds)
  let current = originZoneId
  let total = 0

  while (unvisited.size > 0) {
    let nearest: number | undefined
    let nearestKm = Infinity

    for (const candidate of unvisited) {
      const km = distanceBetween(distances, current, candidate)
      if (km !== undefined && km < nearestKm) {
        nearestKm = km
        nearest = candidate
      }
    }

    if (nearest === undefined) return undefined

    total += nearestKm
    current = nearest
    unvisited.delete(nearest)
  }

  return total
}

export function canJoin(
  pool: PoolSnapshot,
  request: JoinCandidate,
  zones: Map<number, Zone>,
  distances: DistanceMatrix,
  now: Date = new Date(),
): JoinResult {
  // 1 — pool must still be assembling or accepted
  if (pool.status !== 'FORMING' && pool.status !== 'ACCEPTED') {
    return { ok: false, reason: 'pool_not_joinable' }
  }

  // 2 — enough seats left
  if (pool.seatsAvailable < request.seats) {
    return { ok: false, reason: 'pool_full' }
  }

  // 3 — same pickup zone as the pool origin
  if (request.pickupZoneId !== pool.originZoneId) {
    return { ok: false, reason: 'different_pickup_zone' }
  }

  // 5 — somebody currently aboard is still willing to wait, and their deadline
  // (the earliest any member has asked for) has not passed yet
  if (pool.waitUntil === null) {
    return { ok: false, reason: 'not_waiting_for_pool' }
  }
  if (now.getTime() > pool.waitUntil.getTime()) {
    return { ok: false, reason: 'pool_window_expired' }
  }

  const origin = zones.get(pool.originZoneId)
  const newDest = zones.get(request.destinationZoneId)
  if (!origin || !newDest) return { ok: false, reason: 'unknown_zone' }

  // 6 — no destination may point the opposite way from an existing member's
  const newBearing = bearingDeg(origin, newDest)
  for (const member of pool.members) {
    const memberDest = zones.get(member.destinationZoneId)
    if (!memberDest) return { ok: false, reason: 'unknown_zone' }
    const diff = angleDiff(bearingDeg(origin, memberDest), newBearing)
    if (diff > POOL_POLICY.maxBearingDiffDeg) {
      return { ok: false, reason: 'opposite_direction' }
    }
  }

  // 4 — the combined route may not exceed the longest solo leg plus the cap
  const allDestinations = [
    ...new Set([...pool.members.map(m => m.destinationZoneId), request.destinationZoneId]),
  ]

  let longestSoloKm = 0
  for (const destinationId of allDestinations) {
    const soloKm = distanceBetween(distances, pool.originZoneId, destinationId)
    if (soloKm === undefined) return { ok: false, reason: 'no_route' }
    longestSoloKm = Math.max(longestSoloKm, soloKm)
  }

  const routeKm = pooledRouteKm(pool.originZoneId, allDestinations, distances)
  if (routeKm === undefined) return { ok: false, reason: 'no_route' }

  if (routeKm > longestSoloKm + POOL_POLICY.detourCapKm) {
    return { ok: false, reason: 'detour_too_long' }
  }

  return { ok: true }
}
