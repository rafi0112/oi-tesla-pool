import { PoolClient } from 'pg'
import { assertTransition } from '../domain/stateMachine'
import { updateRideStatus } from '../repositories/ride.repo'
import { updatePoolStatus } from '../repositories/pool.repo'
import { insertRideEvent, insertPoolEvent } from '../repositories/event.repo'

/**
 * The only sanctioned way to change a ride's status: assert the transition is
 * legal, write it, and record the event in the same transaction.
 */
export async function transitionRide(
  tx: PoolClient,
  ride: { id: string; status: string },
  next: string,
  actorUserId: string | null,
  reason?: string,
): Promise<void> {
  assertTransition('ride', ride.status, next)
  await updateRideStatus(tx, ride.id, next)
  await insertRideEvent(tx, {
    rideRequestId: ride.id,
    fromStatus:    ride.status,
    toStatus:      next,
    actorUserId,
    reason,
  })
}

export async function transitionPool(
  tx: PoolClient,
  pool: { id: string; status: string },
  next: string,
  actorUserId: string | null,
  reason?: string,
): Promise<void> {
  assertTransition('pool', pool.status, next)
  await updatePoolStatus(tx, pool.id, next)
  await insertPoolEvent(tx, {
    poolId:     pool.id,
    fromStatus: pool.status,
    toStatus:   next,
    actorUserId,
    reason,
  })
}
