import { z } from 'zod'
import { withTransaction } from '../db/pool'
import { findUserById } from '../repositories/user.repo'
import {
  findRideById, setRidePool, lockRideById,
  lockMatchedMembers, setFinalFare,
} from '../repositories/ride.repo'
import {
  findVehicleByDriver,
  findPoolById,
  findPoolByIdForDriver,
  findPoolMembers,
  createPool as insertPool,
  claimSeats,
  lockPoolById,
  PoolRow,
  PoolMemberRow,
} from '../repositories/pool.repo'
import { getZoneMap, getDistanceMatrix } from '../repositories/zone.repo'
import { insertPoolEvent } from '../repositories/event.repo'
import { transitionRide, transitionPool } from './transition'
import { fareFor } from '../domain/fare'
import { toDriverPoolDTO, DriverPoolDTO } from '../dto/driver.dto'
import { canJoin, PoolSnapshot, Zone, DistanceMatrix } from '../domain/matching'
import { assertTransition } from '../domain/stateMachine'
import { ConflictError, NotFoundError, ValidationError } from '../errors'

export const createPoolSchema = z.object({
  rideRequestId: z.string().uuid(),
  waitForPool:   z.boolean(),
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
    waitForPool:    pool.wait_for_pool,
    createdAt:      new Date(pool.created_at),
    members: members
      .filter(m => ACTIVE_MEMBER_STATUSES.has(m.status))
      .map(m => ({
        rideId:            m.ride_id,
        destinationZoneId: m.destination_zone_id,
        seats:             m.seats,
      })),
  }
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

export async function joinPool(
  driverId: string,
  poolId: string,
  data: z.infer<typeof joinPoolSchema>,
): Promise<DriverPoolDTO> {
  const pool = await findPoolByIdForDriver(poolId, driverId)
  if (!pool) throw new NotFoundError('Pool not found')

  const ride = await findRideById(data.rideRequestId)
  if (!ride) throw new NotFoundError('Ride request not found')

  const ctx = await loadJoinContext(pool)

  // Advisory check — gives the driver a precise reason. The seat guarantee is
  // the atomic UPDATE below, not this snapshot.
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
    throw new ConflictError('NOT_JOINABLE', joinRejectionMessage(verdict.reason), {
      reason: verdict.reason,
    })
  }

  await withTransaction(async tx => {
    // Pool before ride, matching every other path that locks both.
    await lockPoolById(tx, poolId)

    // Re-read under a row lock: the advisory checks above used an unlocked
    // snapshot, so this is the authoritative view of the ride.
    const locked = await lockRideById(tx, data.rideRequestId)
    if (!locked) throw new NotFoundError('Ride request not found')

    // Assert before claiming, so a re-submitted accept reports the real reason
    // instead of POOL_FULL when the pool happens to be full.
    assertTransition('ride', locked.status, 'MATCHED')

    const claimed = await claimSeats(tx, poolId, locked.seats)
    if (!claimed) throw new ConflictError('POOL_FULL', 'That seat was just taken')

    await setRidePool(tx, locked.id, poolId)
    await transitionRide(tx, locked, 'MATCHED', driverId)
  })

  return loadPoolDTO(poolId)
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
      const fare = member.distance_km === null
        ? member.quoted_fare_paisa
        : fareFor(member.distance_km, boarding.length)
      await setFinalFare(tx, member.id, fare)
    }
  })

  return loadPoolDTO(poolId)
}

export async function loadPoolDTO(poolId: string): Promise<DriverPoolDTO> {
  const pool = await findPoolById(poolId)
  if (!pool) throw new NotFoundError('Pool not found')
  const members = await findPoolMembers(poolId)
  return toDriverPoolDTO(pool, members)
}
