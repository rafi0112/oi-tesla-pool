import { z } from 'zod'
import { withTransaction } from '../db/pool'
import { getDistance } from '../repositories/zone.repo'
import { soloFare, FARE_POLICY } from '../domain/fare'
import { POOL_POLICY } from '../domain/matching'
import {
  findRideById,
  findRideByIdempotencyKey,
  findRidesByPassenger,
  findActiveRideByPassenger,
  createRide,
  lockRideById,
  countActivePassengersInPool,
  countAllBookingsInPool,
} from '../repositories/ride.repo'
import { lockPoolById, releaseSeats } from '../repositories/pool.repo'
import { updateUserZone } from '../repositories/user.repo'
import { insertFeedback } from '../repositories/feedback.repo'
import { attemptSelfJoin, JoinAttempt } from './pool.service'
import { transitionRide, transitionPool } from './transition'
import { findRideEvents } from '../repositories/event.repo'
import {
  toPassengerRideDTO, PassengerRideDTO,
  toRideEventDTO, RideEventDTO,
} from '../dto/passenger.dto'
import { ConflictError, NotFoundError } from '../errors'

export const createRideSchema = z.object({
  pickupZoneId:      z.number().int().positive(),
  destinationZoneId: z.number().int().positive(),
  seats:             z.number().int().min(1).max(POOL_POLICY.maxSeatsPerBooking),
  // How long this passenger is willing to have a pool wait for more riders —
  // their own decision, never the driver's. 0 means "don't wait for anyone".
  waitMinutes:       z.number().int().min(0).max(POOL_POLICY.maxWaitMinutes).default(0),
  // Extra the passenger offers on top of the normal fare to attract a driver
  // faster — most useful once their last request has expired unanswered
  // (see expireIfStale below), but available on any booking.
  bonusPaisa:        z.number().int().min(0).max(FARE_POLICY.maxBonusPaisa).default(0),
  // Set when the passenger chose "Join this pool" from GET /pools/nearby
  // instead of booking independently.
  poolId:            z.string().uuid().optional(),
})

export interface RequestRideResult {
  ride: PassengerRideDTO
  joinAttempt?: JoinAttempt
}

const REQUEST_EXPIRY_MS = POOL_POLICY.requestExpiryMinutes * 60_000

/**
 * A REQUESTED ride nobody has matched within POOL_POLICY.requestExpiryMinutes
 * expires on its own — there's no scheduler in this project, so this runs the
 * same self-healing way pool.service.ts's autoCloseIfExpired closes a pool's
 * wait window: the next read or action against the ride does the closing.
 * Re-checks status under the row lock, so a concurrent driver accept racing
 * the expiry can't double-transition or throw. Returns true only if this call
 * actually expired it, so a caller listing several rows can drop it from
 * results without a second query.
 */
export async function expireIfStale(rideId: string, createdAt: string): Promise<boolean> {
  if (Date.now() - new Date(createdAt).getTime() < REQUEST_EXPIRY_MS) return false

  return withTransaction(async tx => {
    const locked = await lockRideById(tx, rideId)
    if (!locked || locked.status !== 'REQUESTED') return false
    await transitionRide(tx, locked, 'CANCELLED', null, 'request_expired')
    return true
  })
}

export async function requestRide(
  passengerId: string,
  data: z.infer<typeof createRideSchema>,
  idempotencyKey: string | null,
): Promise<RequestRideResult> {
  // Idempotency — return existing ride if key already used
  if (idempotencyKey) {
    const existing = await findRideByIdempotencyKey(idempotencyKey)
    if (existing) return { ride: toPassengerRideDTO(existing) }
  }

  if (data.pickupZoneId === data.destinationZoneId) {
    throw new ConflictError('VALIDATION_ERROR', 'Pickup and destination must differ')
  }

  // Self-heals a stale unanswered request before trying to book a new one, so
  // "request again after 15 minutes" always works immediately — the passenger
  // never has to first open their ride list to free themselves up.
  const active = await findActiveRideByPassenger(passengerId)
  if (active) await expireIfStale(active.id, active.created_at)

  const distanceKm = await getDistance(data.pickupZoneId, data.destinationZoneId)
  if (distanceKm === null) throw new NotFoundError('No route between these zones')

  // Booked alone so far, so the solo rate, plus whatever bonus this passenger
  // chose to offer — quoted transparently up front, not added in later.
  const quotedFarePaisa = soloFare(distanceKm) + data.bonusPaisa

  let ride
  try {
    ride = await withTransaction(async tx => {
      const created = await createRide(tx, {
        passengerId,
        pickupZoneId:      data.pickupZoneId,
        destinationZoneId: data.destinationZoneId,
        seats:             data.seats,
        waitMinutes:       data.waitMinutes,
        quotedFarePaisa,
        bonusPaisa:        data.bonusPaisa,
        idempotencyKey,
      })
      // Booking from a zone is "being there" — the same signal a driver gives
      // by manually setting their zone. Kept in sync automatically so a
      // passenger's next visit already shows where they last requested from.
      await updateUserZone(passengerId, data.pickupZoneId, tx)
      return created
    })
  } catch (err: unknown) {
    // unique violation on one_active_ride_per_passenger index
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('ALREADY_ACTIVE', 'You already have an active ride')
    }
    throw err
  }

  if (!data.poolId) return { ride: toPassengerRideDTO(ride) }

  // The booking above has already succeeded. A refused or lost-race join must
  // not fail the whole request — it only means this ride stays REQUESTED,
  // same as if the passenger had never picked a pool.
  const joinAttempt = await attemptSelfJoin(passengerId, data.poolId, ride.id)
  const finalRide = joinAttempt.ok ? await findRideById(ride.id, passengerId) : ride
  return { ride: toPassengerRideDTO(finalRide!), joinAttempt }
}

export async function getMyRides(passengerId: string): Promise<PassengerRideDTO[]> {
  const rides = await findRidesByPassenger(passengerId)

  let anyExpired = false
  for (const r of rides) {
    if (r.status === 'REQUESTED' && await expireIfStale(r.id, r.created_at)) anyExpired = true
  }
  const fresh = anyExpired ? await findRidesByPassenger(passengerId) : rides

  return fresh.map(toPassengerRideDTO)
}

/**
 * Cancels the caller's own ride. The transition table refuses this once the
 * passenger is aboard (PICKED_UP has no CANCELLED edge), so no status check is
 * needed here. Seats go back and, if that empties the pool, the pool closes too —
 * all in the one transaction.
 */
export async function cancelRide(
  passengerId: string,
  rideId: string,
): Promise<PassengerRideDTO> {
  const owned = await findRideById(rideId, passengerId)
  if (!owned) throw new NotFoundError('Ride not found')

  await withTransaction(async tx => {
    // Pool before ride. Every path that locks both uses this order, so they
    // cannot deadlock against each other.
    if (owned.pool_id !== null) await lockPoolById(tx, owned.pool_id)

    const locked = await lockRideById(tx, rideId)
    if (!locked) throw new NotFoundError('Ride not found')

    await transitionRide(tx, locked, 'CANCELLED', passengerId)

    if (locked.pool_id === null) return

    // Re-locks the same row harmlessly, and covers the case where the driver
    // pooled this ride between the unlocked read above and the ride lock.
    const pool = await lockPoolById(tx, locked.pool_id)
    if (!pool) return

    await releaseSeats(tx, locked.pool_id, locked.seats)

    const activeLeft = await countActivePassengersInPool(tx, locked.pool_id)
    if (activeLeft > 0) return

    // Nobody left aboard. Whether this passenger was ever joined by another
    // decides which reason the audit trail records.
    const everBooked = await countAllBookingsInPool(tx, locked.pool_id)
    await transitionPool(
      tx,
      pool,
      'CANCELLED',
      passengerId,
      everBooked <= 1 ? 'sole_passenger_cancelled' : 'all_passengers_cancelled',
    )
  })

  const updated = await findRideById(rideId, passengerId)
  return toPassengerRideDTO(updated!)
}

export interface RideDetail {
  ride: PassengerRideDTO
  timeline: RideEventDTO[]
}

export async function getRideById(id: string, passengerId: string): Promise<RideDetail> {
  let ride = await findRideById(id, passengerId)
  if (!ride) throw new NotFoundError('Ride not found')

  if (ride.status === 'REQUESTED' && await expireIfStale(ride.id, ride.created_at)) {
    ride = (await findRideById(id, passengerId)) ?? ride
  }

  const events = await findRideEvents(ride.id)
  return {
    ride:     toPassengerRideDTO(ride),
    timeline: events.map(e => toRideEventDTO(e, passengerId)),
  }
}

export const submitFeedbackSchema = z.object({
  rating:  z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(500).optional(),
})

/**
 * A passenger may rate a ride only once they've actually been dropped off —
 * not while waiting, not while aboard — and only once ever, enforced by
 * ride_feedback's own UNIQUE(ride_request_id) rather than a read-then-write
 * check here.
 */
export async function submitFeedback(
  passengerId: string,
  rideId: string,
  data: z.infer<typeof submitFeedbackSchema>,
): Promise<PassengerRideDTO> {
  const owned = await findRideById(rideId, passengerId)
  if (!owned) throw new NotFoundError('Ride not found')

  if (owned.status !== 'DROPPED_OFF') {
    throw new ConflictError(
      'NOT_DROPPED_OFF',
      'You can only rate a ride once you’ve been dropped off',
    )
  }

  try {
    await withTransaction(tx => insertFeedback(tx, {
      rideRequestId: rideId,
      passengerId,
      rating:        data.rating,
      comment:       data.comment ?? null,
    }))
  } catch (err: unknown) {
    // unique violation on ride_feedback's ride_request_id
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('FEEDBACK_ALREADY_GIVEN', 'You already rated this ride')
    }
    throw err
  }

  const updated = await findRideById(rideId, passengerId)
  return toPassengerRideDTO(updated!)
}
