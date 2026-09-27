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
} from '../repositories/ride.repo'
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
