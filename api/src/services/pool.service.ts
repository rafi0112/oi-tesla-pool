import { z } from 'zod'
import { withTransaction } from '../db/pool'
import { findUserById } from '../repositories/user.repo'
import { findRideById, setRidePool } from '../repositories/ride.repo'
import {
  findVehicleByDriver,
  findPoolById,
  findPoolMembers,
  createPool as insertPool,
} from '../repositories/pool.repo'
import { insertPoolEvent } from '../repositories/event.repo'
import { transitionRide } from './transition'
import { toDriverPoolDTO, DriverPoolDTO } from '../dto/driver.dto'
import { ConflictError, NotFoundError, ValidationError } from '../errors'

export const createPoolSchema = z.object({
  rideRequestId: z.string().uuid(),
  waitForPool:   z.boolean(),
})

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

  const status = data.waitForPool ? 'FORMING' : 'ACCEPTED'

  let poolId: string
  try {
    poolId = await withTransaction(async tx => {
      const id = await insertPool(tx, {
        vehicleId:      vehicle.id,
        originZoneId:   ride.pickup_zone_id,
        seatsAvailable: vehicle.seat_capacity - ride.seats,
        status,
        waitForPool:    data.waitForPool,
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

export async function loadPoolDTO(poolId: string): Promise<DriverPoolDTO> {
  const pool = await findPoolById(poolId)
  if (!pool) throw new NotFoundError('Pool not found')
  const members = await findPoolMembers(poolId)
  return toDriverPoolDTO(pool, members)
}
