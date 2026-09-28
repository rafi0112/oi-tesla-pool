import { z } from 'zod'
import { withTransaction } from '../db/pool'
import { findUserById } from '../repositories/user.repo'
import {
  findRideById, setRidePool, lockRideById, isMatchedInPool,
  lockMatchedMembers, setFinalFare, countPickedUpInPool,
} from '../repositories/ride.repo'
import {
  findVehicleByDriver,
  findPoolById,
  findPoolByIdForDriver,
  findActivePoolByDriver,
  findFormingPoolsByOriginZone,
  findPoolMembers,
  createPool as insertPool,
  claimSeats,
  lockPoolById,
  ratchetWaitUntil,
  clearWaitUntil,
  halveWaitUntil,
  PoolRow,
  PoolMemberRow,
} from '../repositories/pool.repo'
import { getZoneMap, getDistanceMatrix } from '../repositories/zone.repo'
import { insertPoolEvent } from '../repositories/event.repo'
import { transitionRide, transitionPool } from './transition'
import { fareFor } from '../domain/fare'
import { toDriverPoolDTO, DriverPoolDTO } from '../dto/driver.dto'
import { toPoolOptionDTO, PoolOptionDTO } from '../dto/poolOption.dto'
import { canJoin, PoolSnapshot, Zone, DistanceMatrix } from '../domain/matching'
import { assertTransition } from '../domain/stateMachine'
import { ConflictError, NotFoundError, ValidationError } from '../errors'

export const createPoolSchema = z.object({
  rideRequestId: z.string().uuid(),
})

export const joinPoolSchema = z.object({
  rideRequestId: z.string().uuid(),
})

const ACTIVE_MEMBER_STATUSES = new Set(['MATCHED', 'PICKED_UP'])

export interface JoinContext {
  snapshot: PoolSnapshot
  zones: Map<number, Zone>
  distances: DistanceMatrix
}

/**
 * Everything canJoin needs for one pool. Shared by the join endpoint and the
 * driver's request feed so the feed can never advertise a request as joinable
 * that the join itself would refuse.
 */
export async function loadJoinContext(pool: PoolRow): Promise<JoinContext> {
  const [members, zones, distances] = await Promise.all([
    findPoolMembers(pool.id),
    getZoneMap(),
    getDistanceMatrix(),
  ])
  return { snapshot: toSnapshot(pool, members), zones, distances }
}

function toSnapshot(pool: PoolRow, members: PoolMemberRow[]): PoolSnapshot {
  return {
    status:         pool.status,
    seatsAvailable: pool.seats_available,
    originZoneId:   pool.origin_zone_id,
    waitUntil:      pool.wait_until === null ? null : new Date(pool.wait_until),
    members: members
      .filter(m => ACTIVE_MEMBER_STATUSES.has(m.status))
      .map(m => ({
        rideId:            m.ride_id,
        destinationZoneId: m.destination_zone_id,
        seats:             m.seats,
      })),
  }
}

/**
 * If this pool is still marked FORMING but its wait deadline has already
 * passed, closes it automatically — the passenger-chosen wait time running out
 * is what triggers FORMING → ACCEPTED, not a driver clicking anything. No
 * human acted, so the event is logged with a null actor. Re-checks status
 * under the row lock, so a manual close racing an expiry — or two concurrent
 * callers hitting this at once — can't double-transition or throw.
 */
async function autoCloseIfExpired(
  poolId: string,
  status: string,
  waitUntil: string | null,
): Promise<void> {
  if (status !== 'FORMING' || waitUntil === null) return
  if (new Date(waitUntil).getTime() > Date.now()) return

  await withTransaction(async tx => {
    const locked = await lockPoolById(tx, poolId)
    if (!locked || locked.status !== 'FORMING') return
    await transitionPool(tx, locked, 'ACCEPTED', null, 'wait_time_elapsed')
    await clearWaitUntil(tx, poolId)
  })
}

/**
 * Fetches a pool, auto-closing it first if its wait time just elapsed, so
 * every caller sees the true current status rather than a FORMING that would
 * have flipped on its own the moment anyone looked. Every read of a pool by id
 * anywhere in this file goes through one of these two wrappers rather than
 * calling the repo directly, specifically so nothing can act on a stale row.
 */
async function findPoolFresh(poolId: string): Promise<PoolRow | null> {
  const pool = await findPoolById(poolId)
  if (!pool) return null
  await autoCloseIfExpired(pool.id, pool.status, pool.wait_until)
  return (await findPoolById(poolId)) ?? pool
}

/** Same, but ownership-scoped — preserves the 404-not-403 semantics for driver actions. */
async function findPoolFreshForDriver(poolId: string, driverId: string): Promise<PoolRow | null> {
  const pool = await findPoolByIdForDriver(poolId, driverId)
  if (!pool) return null
  await autoCloseIfExpired(pool.id, pool.status, pool.wait_until)
  return (await findPoolByIdForDriver(poolId, driverId)) ?? pool
}

export async function createPool(
  driverId: string,
  data: z.infer<typeof createPoolSchema>,
): Promise<DriverPoolDTO> {
  const driver = await findUserById(driverId)
  if (!driver) throw new NotFoundError('Driver not found')

  if (driver.current_zone_id === null) {
    throw new ValidationError({ zoneId: ['You must go online in a zone before accepting rides'] })
  }

  const vehicle = await findVehicleByDriver(driverId)
  if (!vehicle) throw new NotFoundError('No vehicle registered for this driver')

  const ride = await findRideById(data.rideRequestId)
  if (!ride) throw new NotFoundError('Ride request not found')

  if (ride.pickup_zone_id !== driver.current_zone_id) {
    throw new ConflictError(
      'NOT_JOINABLE',
      'That passenger is not in your current zone',
      { reason: 'different_pickup_zone' },
    )
  }

  if (ride.seats > vehicle.seat_capacity) {
    throw new ConflictError('POOL_FULL', 'That request needs more seats than the vehicle has')
  }

  // The deciding vote is the passenger's own, cast at booking time — the
  // driver accepting the request no longer chooses whether it waits.
  const status = ride.wait_minutes > 0 ? 'FORMING' : 'ACCEPTED'
  const waitUntil = ride.wait_minutes > 0
    ? new Date(Date.now() + ride.wait_minutes * 60_000)
    : null

  let poolId: string
  try {
    poolId = await withTransaction(async tx => {
      const id = await insertPool(tx, {
        vehicleId:      vehicle.id,
        originZoneId:   ride.pickup_zone_id,
        seatsAvailable: vehicle.seat_capacity - ride.seats,
        status,
        waitUntil,
      })

      // Pool creation has no prior status, so it is logged directly rather than
      // through transitionPool.
      await insertPoolEvent(tx, {
        poolId:      id,
        fromStatus:  null,
        toStatus:    status,
        actorUserId: driverId,
        reason:      'pool_created',
      })

      await setRidePool(tx, ride.id, id)
      await transitionRide(tx, ride, 'MATCHED', driverId)

      return id
    })
  } catch (err: unknown) {
    // one_active_pool_per_vehicle partial unique index
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('ALREADY_ACTIVE', 'You already have an active pool')
    }
    throw err
  }

  return loadPoolDTO(poolId)
}

/**
 * The atomic core shared by every path that joins a ride to a pool: lock pool
 * before ride (matching every other path that locks both, so nothing can
 * deadlock against it), assert the transition, claim the seat, attach and
 * transition the ride, then let the newcomer's own patience shorten — never
 * lengthen — how much longer the pool stays open. Throws NotFoundError /
 * ConflictError on failure — callers decide whether that means the whole
 * request fails (driver's explicit accept) or is caught and reported as a
 * soft failure (a passenger's best-effort self-join).
 */
async function runAtomicJoin(actorId: string, poolId: string, rideId: string): Promise<void> {
  await withTransaction(async tx => {
    await lockPoolById(tx, poolId)

    // Re-read under a row lock: any advisory check above used an unlocked
    // snapshot, so this is the authoritative view of the ride.
    const locked = await lockRideById(tx, rideId)
    if (!locked) throw new NotFoundError('Ride request not found')

    // Assert before claiming, so a re-submitted accept reports the real reason
    // instead of POOL_FULL when the pool happens to be full.
    assertTransition('ride', locked.status, 'MATCHED')

    const claimed = await claimSeats(tx, poolId, locked.seats)
    if (!claimed) throw new ConflictError('POOL_FULL', 'That seat was just taken')

    await setRidePool(tx, locked.id, poolId)
    await transitionRide(tx, locked, 'MATCHED', actorId)

    // A wait_minutes of 0 means "no preference of my own" — it neither opens
    // nor shortens the window; it simply doesn't speak to the question.
    if (locked.wait_minutes > 0) {
      await ratchetWaitUntil(tx, poolId, new Date(Date.now() + locked.wait_minutes * 60_000))
    }
  })
}

export async function joinPool(
  driverId: string,
  poolId: string,
  data: z.infer<typeof joinPoolSchema>,
): Promise<DriverPoolDTO> {
  const pool = await findPoolFreshForDriver(poolId, driverId)
  if (!pool) throw new NotFoundError('Pool not found')

  const ride = await findRideById(data.rideRequestId)
  if (!ride) throw new NotFoundError('Ride request not found')

  const ctx = await loadJoinContext(pool)

  // Advisory check — gives the driver a precise reason. The seat guarantee is
  // the atomic UPDATE inside runAtomicJoin, not this snapshot.
  const verdict = canJoin(
    ctx.snapshot,
    {
      seats:             ride.seats,
      pickupZoneId:      ride.pickup_zone_id,
      destinationZoneId: ride.destination_zone_id,
    },
    ctx.zones,
    ctx.distances,
  )
  if (!verdict.ok) {
    // §3.6 assigns POOL_FULL to "no seats left", so report that code whether the
    // shortage was seen here or by the atomic claim losing a race below.
    const code = verdict.reason === 'pool_full' ? 'POOL_FULL' : 'NOT_JOINABLE'
    throw new ConflictError(code, joinRejectionMessage(verdict.reason), {
      reason: verdict.reason,
    })
  }

  await runAtomicJoin(driverId, poolId, data.rideRequestId)
  return loadPoolDTO(poolId)
}

export interface JoinAttempt {
  ok: boolean
  reason?: string
  message?: string
}

/**
 * Best-effort self-join, run right after a passenger books with a chosen pool.
 * Unlike joinPool, a refusal here never throws: the booking above has already
 * succeeded and must stand on its own, so an expired window or a lost race
 * just means the new ride stays REQUESTED, exactly as if no pool had been
 * chosen. The passenger sees why in the response and can wait for a driver.
 */
export async function attemptSelfJoin(
  passengerId: string,
  poolId: string,
  rideId: string,
): Promise<JoinAttempt> {
  const pool = await findPoolFresh(poolId)
  if (!pool) return { ok: false, reason: 'pool_not_found', message: 'That pool is no longer available' }

  const ride = await findRideById(rideId, passengerId)
  if (!ride) return { ok: false, reason: 'not_found', message: 'Ride not found' }

  const ctx = await loadJoinContext(pool)
  const verdict = canJoin(
    ctx.snapshot,
    {
      seats:             ride.seats,
      pickupZoneId:      ride.pickup_zone_id,
      destinationZoneId: ride.destination_zone_id,
    },
    ctx.zones,
    ctx.distances,
  )
  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason, message: joinRejectionMessage(verdict.reason) }
  }

  try {
    await runAtomicJoin(passengerId, poolId, rideId)
    return { ok: true }
  } catch (err) {
    if (err instanceof ConflictError) {
      return { ok: false, reason: 'race_lost', message: err.message }
    }
    throw err
  }
}

/**
 * FORMING pools a passenger could join right now, given where they are
 * boarding, where they are headed, and how many seats they need. Every pool in
 * the zone is returned, joinable or not, with the same rejection reason the
 * join itself would give — so a passenger whose destination doesn't fit any
 * open pool sees why, rather than an empty list they can't distinguish from
 * "nobody is pooling yet".
 */
export async function findNearbyPools(
  pickupZoneId: number,
  destinationZoneId: number,
  seats: number,
): Promise<PoolOptionDTO[]> {
  const candidates = await findFormingPoolsByOriginZone(pickupZoneId)
  if (candidates.length === 0) return []

  // A candidate's wait time may have elapsed since it was last touched — close
  // it now rather than advertise a FORMING pool that canJoin would refuse
  // anyway, then re-query so the closed ones drop out naturally.
  await Promise.all(candidates.map(p => autoCloseIfExpired(p.id, p.status, p.wait_until)))
  const pools = await findFormingPoolsByOriginZone(pickupZoneId)
  if (pools.length === 0) return []

  const [zones, distances] = await Promise.all([getZoneMap(), getDistanceMatrix()])

  const options = await Promise.all(pools.map(async pool => {
    const members = await findPoolMembers(pool.id)
    const verdict = canJoin(
      toSnapshot(pool, members),
      { seats, pickupZoneId, destinationZoneId },
      zones,
      distances,
    )
    const memberGenders = members
      .filter(m => ACTIVE_MEMBER_STATUSES.has(m.status))
      .map(m => m.passenger_gender)
    return toPoolOptionDTO(
      pool, memberGenders, verdict, verdict.ok ? undefined : joinRejectionMessage(verdict.reason),
    )
  }))

  // Joinable options first, then by seats available, so the best fit leads.
  return options.sort((a, b) => Number(b.joinable) - Number(a.joinable) || b.seatsAvailable - a.seatsAvailable)
}

/**
 * Any passenger currently waiting in a FORMING pool — not just the one whose
 * own wait_minutes opened it — can press "urgent" to halve however much time
 * is actually left, if they can't wait as long as the room currently expects.
 * The result is the one wait_until every member (and the driver) already
 * reads, so this is the whole mechanism by which everyone sees the shorter
 * timer: nothing is pushed to anyone, the next poll just sees a smaller
 * number. Every downstream rule — canJoin's window check, autoCloseIfExpired,
 * the nearby listing's countdown — reads wait_until the same way regardless
 * of who shortened it or why, so nothing else needs to change to make "the
 * rest of the functionality work accordingly" true.
 */
export async function applyUrgency(passengerId: string, poolId: string): Promise<{ poolWaitUntil: string }> {
  const pool = await findPoolFresh(poolId)
  if (!pool) throw new NotFoundError('Pool not found')

  // 404, not 403 — same reasoning as every other ownership check in this
  // file: a passenger who isn't aboard this pool has no business learning it
  // exists, let alone that it's currently FORMING.
  const isMember = await isMatchedInPool(passengerId, poolId)
  if (!isMember) throw new NotFoundError('Pool not found')

  if (pool.status !== 'FORMING' || pool.wait_until === null) {
    throw new ConflictError(
      'NOT_WAITING',
      'This pool isn’t waiting for anyone right now — there’s no timer to reduce',
    )
  }

  const poolWaitUntil = await withTransaction(async tx => {
    const locked = await lockPoolById(tx, poolId)
    const halved = locked ? await halveWaitUntil(tx, poolId) : null
    if (!locked || halved === null) {
      throw new ConflictError(
        'NOT_WAITING',
        'This pool isn’t waiting for anyone right now — there’s no timer to reduce',
      )
    }
    await insertPoolEvent(tx, {
      poolId, fromStatus: 'FORMING', toStatus: 'FORMING', actorUserId: passengerId, reason: 'urgency_halved',
    })
    return halved
  })

  return { poolWaitUntil }
}

export function joinRejectionMessage(reason: string | undefined): string {
  switch (reason) {
    case 'pool_not_joinable':     return 'This pool is no longer accepting passengers'
    case 'pool_full':             return 'No seats left in this pool'
    case 'different_pickup_zone': return 'That passenger is not in this pool’s pickup zone'
    case 'not_waiting_for_pool':  return 'The first passenger chose not to wait for others'
    case 'pool_window_expired':   return 'The pooling window for this trip has closed'
    case 'opposite_direction':    return 'That destination is in the opposite direction'
    case 'detour_too_long':       return 'Adding that passenger would detour the trip too far'
    default:                      return 'That passenger cannot join this pool'
  }
}

/** Shared by the actions whose only effect is a pool status change. */
async function transitionOwnedPool(
  driverId: string,
  poolId: string,
  next: string,
): Promise<DriverPoolDTO> {
  const owned = await findPoolFreshForDriver(poolId, driverId)
  if (!owned) throw new NotFoundError('Pool not found')

  await withTransaction(async tx => {
    const pool = await lockPoolById(tx, poolId)
    if (!pool) throw new NotFoundError('Pool not found')
    await transitionPool(tx, pool, next, driverId)
  })

  return loadPoolDTO(poolId)
}

/**
 * Ends the assembling window early. The transition table refuses a non-FORMING
 * pool. wait_until is cleared in the same transaction — otherwise a pool closed
 * with time still on the clock would remain joinable until it elapsed, which
 * would make "closed" a lie.
 */
export async function closePool(driverId: string, poolId: string): Promise<DriverPoolDTO> {
  const owned = await findPoolFreshForDriver(poolId, driverId)
  if (!owned) throw new NotFoundError('Pool not found')

  await withTransaction(async tx => {
    const pool = await lockPoolById(tx, poolId)
    if (!pool) throw new NotFoundError('Pool not found')
    await transitionPool(tx, pool, 'ACCEPTED', driverId)
    await clearWaitUntil(tx, poolId)
  })

  return loadPoolDTO(poolId)
}

export function markArrived(driverId: string, poolId: string): Promise<DriverPoolDTO> {
  return transitionOwnedPool(driverId, poolId, 'DRIVER_ARRIVED')
}

/** Drops one passenger. PICKED_UP is the only status with a DROPPED_OFF edge. */
export async function dropOffPassenger(
  driverId: string,
  poolId: string,
  rideId: string,
): Promise<DriverPoolDTO> {
  const owned = await findPoolByIdForDriver(poolId, driverId)
  if (!owned) throw new NotFoundError('Pool not found')

  await withTransaction(async tx => {
    await lockPoolById(tx, poolId)

    const ride = await lockRideById(tx, rideId)
    if (!ride || ride.pool_id !== poolId) {
      throw new NotFoundError('Ride not found in this pool')
    }

    await transitionRide(tx, ride, 'DROPPED_OFF', driverId)
  })

  return loadPoolDTO(poolId)
}

export async function completeTrip(driverId: string, poolId: string): Promise<DriverPoolDTO> {
  const owned = await findPoolByIdForDriver(poolId, driverId)
  if (!owned) throw new NotFoundError('Pool not found')

  await withTransaction(async tx => {
    const pool = await lockPoolById(tx, poolId)
    if (!pool) throw new NotFoundError('Pool not found')

    const stillAboard = await countPickedUpInPool(tx, poolId)
    if (stillAboard > 0) {
      throw new ConflictError(
        'INVALID_TRANSITION',
        'Drop off every passenger before completing the trip',
        { stillAboard },
      )
    }

    await transitionPool(tx, pool, 'COMPLETED', driverId)
  })

  return loadPoolDTO(poolId)
}

export async function getActivePool(driverId: string): Promise<DriverPoolDTO | null> {
  const found = await findActivePoolByDriver(driverId)
  if (!found) return null
  await autoCloseIfExpired(found.id, found.status, found.wait_until)
  const pool = (await findActivePoolByDriver(driverId)) ?? found
  const members = await findPoolMembers(pool.id)
  return toDriverPoolDTO(pool, members)
}

/**
 * Boards everyone and starts the trip. The membership at this instant fixes
 * every fare permanently — final_fare_paisa is written once here and the read
 * path stops recomputing from that point on.
 */
export async function startTrip(driverId: string, poolId: string): Promise<DriverPoolDTO> {
  const owned = await findPoolByIdForDriver(poolId, driverId)
  if (!owned) throw new NotFoundError('Pool not found')

  await withTransaction(async tx => {
    const pool = await lockPoolById(tx, poolId)
    if (!pool) throw new NotFoundError('Pool not found')

    const boarding = await lockMatchedMembers(tx, poolId)

    await transitionPool(tx, pool, 'EN_ROUTE', driverId)

    for (const member of boarding) {
      await transitionRide(tx, member, 'PICKED_UP', driverId)
      // quoted_fare_paisa already has this member's own bonus folded in (see
      // requestRide in ride.service.ts); the distance-known branch adds it
      // explicitly, same split farePaisaFor uses everywhere else.
      const fare = member.distance_km === null
        ? member.quoted_fare_paisa
        : fareFor(member.distance_km, boarding.length) + member.bonus_paisa
      await setFinalFare(tx, member.id, fare)
    }
  })

  return loadPoolDTO(poolId)
}

export async function loadPoolDTO(poolId: string): Promise<DriverPoolDTO> {
  const pool = await findPoolFresh(poolId)
  if (!pool) throw new NotFoundError('Pool not found')
  const members = await findPoolMembers(poolId)
  return toDriverPoolDTO(pool, members)
}
