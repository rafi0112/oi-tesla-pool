import { PoolClient } from 'pg'
import { db } from '../db/pool'

export interface RideRow {
  id: string
  passenger_id: string
  pool_id: string | null
  pickup_zone_id: number
  pickup_zone_name: string
  destination_zone_id: number
  destination_zone_name: string
  seats: number
  quoted_fare_paisa: number
  final_fare_paisa: number | null
  status: string
  idempotency_key: string | null
  created_at: string
}

const SELECT_RIDE = `
  SELECT r.*,
         pz.name AS pickup_zone_name,
         dz.name AS destination_zone_name
  FROM   ride_requests r
  JOIN   zones pz ON pz.id = r.pickup_zone_id
  JOIN   zones dz ON dz.id = r.destination_zone_id
`

export async function findRideById(id: string, passengerId?: string): Promise<RideRow | null> {
  const where = passengerId
    ? `WHERE r.id = $1 AND r.passenger_id = $2`
    : `WHERE r.id = $1`
  const params = passengerId ? [id, passengerId] : [id]
  const { rows } = await db.query<RideRow>(`${SELECT_RIDE} ${where}`, params)
  return rows[0] ?? null
}

export async function findRideByIdempotencyKey(key: string): Promise<RideRow | null> {
  const { rows } = await db.query<RideRow>(
    `${SELECT_RIDE} WHERE r.idempotency_key = $1`,
    [key],
  )
  return rows[0] ?? null
}

export async function findRidesByPassenger(passengerId: string): Promise<RideRow[]> {
  const { rows } = await db.query<RideRow>(
    `${SELECT_RIDE} WHERE r.passenger_id = $1 ORDER BY r.created_at DESC`,
    [passengerId],
  )
  return rows
}

export async function createRide(
  tx: PoolClient,
  data: {
    passengerId: string
    pickupZoneId: number
    destinationZoneId: number
    seats: number
    quotedFarePaisa: number
    idempotencyKey: string | null
  },
): Promise<RideRow> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO ride_requests
       (passenger_id, pickup_zone_id, destination_zone_id, seats, quoted_fare_paisa, status, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, 'REQUESTED', $6)
     RETURNING id`,
    [data.passengerId, data.pickupZoneId, data.destinationZoneId, data.seats, data.quotedFarePaisa, data.idempotencyKey],
  )
  const ride = await findRideById(rows[0].id)
  return ride!
}

export async function updateRideStatus(
  tx: PoolClient,
  rideId: string,
  status: string,
): Promise<void> {
  await tx.query(`UPDATE ride_requests SET status = $2 WHERE id = $1`, [rideId, status])
}

export async function setRidePool(
  tx: PoolClient,
  rideId: string,
  poolId: string,
): Promise<void> {
  await tx.query(`UPDATE ride_requests SET pool_id = $2 WHERE id = $1`, [rideId, poolId])
}

export async function countActivePassengersInPool(tx: PoolClient, poolId: string): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ride_requests
     WHERE pool_id = $1 AND status IN ('MATCHED','PICKED_UP')`,
    [poolId],
  )
  return parseInt(rows[0].count, 10)
}
