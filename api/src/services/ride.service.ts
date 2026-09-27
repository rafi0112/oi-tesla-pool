import { z } from 'zod'
import { withTransaction } from '../db/pool'
import { getDistance } from '../repositories/zone.repo'
import { soloFare } from '../domain/fare'
import { POOL_POLICY } from '../domain/matching'
import {
  findRideById,
  findRideByIdempotencyKey,
  findRidesByPassenger,
  createRide,
  lockRideById,
  countActivePassengersInPool,
  countAllBookingsInPool,
} from '../repositories/ride.repo'
import { lockPoolById, releaseSeats } from '../repositories/pool.repo'
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
})

export async function requestRide(
  passengerId: string,
  data: z.infer<typeof createRideSchema>,
  idempotencyKey: string | null,
): Promise<PassengerRideDTO> {
  // Idempotency — return existing ride if key already used
  if (idempotencyKey) {
    const existing = await findRideByIdempotencyKey(idempotencyKey)
    if (existing) return toPassengerRideDTO(existing)
  }

  if (data.pickupZoneId === data.destinationZoneId) {
    throw new ConflictError('VALIDATION_ERROR', 'Pickup and destination must differ')
  }

  const distanceKm = await getDistance(data.pickupZoneId, data.destinationZoneId)
  if (distanceKm === null) throw new NotFoundError('No route between these zones')

  // Booked alone so far, so the solo rate. Seats do not change the fare.
  const quotedFarePaisa = soloFare(distanceKm)

  try {
    const ride = await withTransaction(tx =>
      createRide(tx, {
        passengerId,
        pickupZoneId:      data.pickupZoneId,
        destinationZoneId: data.destinationZoneId,
        seats:             data.seats,
        quotedFarePaisa,
        idempotencyKey,
      }),
    )
    return toPassengerRideDTO(ride)
  } catch (err: unknown) {
    // unique violation on one_active_ride_per_passenger index
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('ALREADY_ACTIVE', 'You already have an active ride')
    }
    throw err
  }
}

export async function getMyRides(passengerId: string): Promise<PassengerRideDTO[]> {
  const rides = await findRidesByPassenger(passengerId)
  return rides.map(toPassengerRideDTO)
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
    const locked = await lockRideById(tx, rideId)
    if (!locked) throw new NotFoundError('Ride not found')

    await transitionRide(tx, locked, 'CANCELLED', passengerId)

    if (locked.pool_id === null) return

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
  const ride = await findRideById(id, passengerId)
  if (!ride) throw new NotFoundError('Ride not found')

  const events = await findRideEvents(ride.id)
  return {
    ride:     toPassengerRideDTO(ride),
    timeline: events.map(e => toRideEventDTO(e, passengerId)),
  }
}
