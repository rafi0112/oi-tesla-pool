import { PoolClient } from 'pg'
import { db } from '../db/pool'

export interface StatusEventRow {
  id: string
  from_status: string | null
  to_status: string
  actor_user_id: string | null
  reason: string | null
  created_at: string
}

export async function insertPoolEvent(
  tx: PoolClient,
  data: {
    poolId: string
    fromStatus: string | null
    toStatus: string
    actorUserId: string | null
    reason?: string | null
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO pool_status_events (pool_id, from_status, to_status, actor_user_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [data.poolId, data.fromStatus, data.toStatus, data.actorUserId, data.reason ?? null],
  )
}

export async function insertRideEvent(
  tx: PoolClient,
  data: {
    rideRequestId: string
    fromStatus: string | null
    toStatus: string
    actorUserId: string | null
    reason?: string | null
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO ride_status_events (ride_request_id, from_status, to_status, actor_user_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [data.rideRequestId, data.fromStatus, data.toStatus, data.actorUserId, data.reason ?? null],
  )
}

export async function findRideEvents(rideRequestId: string): Promise<StatusEventRow[]> {
  const { rows } = await db.query<StatusEventRow>(
    `SELECT id, from_status, to_status, actor_user_id, reason, created_at
     FROM   ride_status_events
     WHERE  ride_request_id = $1
     ORDER  BY created_at`,
    [rideRequestId],
  )
  return rows
}

export async function findPoolEvents(poolId: string): Promise<StatusEventRow[]> {
  const { rows } = await db.query<StatusEventRow>(
    `SELECT id, from_status, to_status, actor_user_id, reason, created_at
     FROM   pool_status_events
     WHERE  pool_id = $1
     ORDER  BY created_at`,
    [poolId],
  )
  return rows
}
