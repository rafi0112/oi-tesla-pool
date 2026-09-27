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
  /** Trip length, used to recompute the displayed fare from live membership. */
  distance_km: number | null
  /** Other active bookings sharing this ride's pool — excludes this row. */
  shared_with: number
}

// distance_km is NUMERIC and shared_with is a COUNT, both of which pg hands back
// as strings; mapRide coerces them so callers only ever see numbers.
interface RawRideRow extends Omit<RideRow, 'distance_km' | 'shared_with'> {
  distance_km: string | null
  shared_with: string
}

const SELECT_RIDE = `
  SELECT r.*,
         pz.name AS pickup_zone_name,
         dz.name AS destination_zone_name,
         zd.distance_km,
         (SELECT COUNT(*)
            FROM ride_requests peer
           WHERE peer.pool_id = r.pool_id
             AND peer.id <> r.id
             AND peer.status IN ('MATCHED','PICKED_UP')) AS shared_with
  FROM   ride_requests r
  JOIN   zones pz ON pz.id = r.pickup_zone_id
  JOIN   zones dz ON dz.id = r.destination_zone_id
  LEFT JOIN zone_distances zd
         ON zd.from_zone_id = r.pickup_zone_id
        AND zd.to_zone_id   = r.destination_zone_id
`

function mapRide(r: RawRideRow): RideRow {
  return {
    ...r,
    distance_km: r.distance_km === null ? null : Number(r.distance_km),
    shared_with: Number(r.shared_with),
  }
}

export async function findRideById(id: string, passengerId?: string): Promise<RideRow | null> {
  const where = passengerId
    ? `WHERE r.id = $1 AND r.passenger_id = $2`
    : `WHERE r.id = $1`
  const params = passengerId ? [id, passengerId] : [id]
  const { rows } = await db.query<RawRideRow>(`${SELECT_RIDE} ${where}`, params)
  return rows[0] ? mapRide(rows[0]) : null
}

export async function findRideByIdempotencyKey(key: string): Promise<RideRow | null> {
  const { rows } = await db.query<RawRideRow>(
    `${SELECT_RIDE} WHERE r.idempotency_key = $1`,
    [key],
  )
  return rows[0] ? mapRide(rows[0]) : null
}

export async function findRidesByPassenger(passengerId: string): Promise<RideRow[]> {
  const { rows } = await db.query<RawRideRow>(
    `${SELECT_RIDE} WHERE r.passenger_id = $1 ORDER BY r.created_at DESC`,
    [passengerId],
  )
  return rows.map(mapRide)
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

export interface RideCoreRow {
  id: string
  passenger_id: string
  pool_id: string | null
  pickup_zone_id: number
  destination_zone_id: number
  seats: number
  status: string
}

/**
 * Locks the ride row for the rest of the transaction. Concurrent attempts to
 * move the same ride serialise here, so a double-submit cannot claim seats twice.
 */
export async function lockRideById(
  tx: PoolClient,
  id: string,
): Promise<RideCoreRow | null> {
  const { rows } = await tx.query<RideCoreRow>(
    `SELECT id, passenger_id, pool_id, pickup_zone_id, destination_zone_id, seats, status
     FROM   ride_requests
     WHERE  id = $1
     FOR UPDATE`,
    [id],
  )
  return rows[0] ?? null
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

export interface OpenRequestRow {
  id: string
  passenger_name: string
  seats: number
  pickup_zone_id: number
  pickup_zone_name: string
  destination_zone_id: number
  destination_zone_name: string
  created_at: string
}

/** Served by the open_requests_by_zone partial index. */
export async function findOpenRequestsInZone(zoneId: number): Promise<OpenRequestRow[]> {
  const { rows } = await db.query<OpenRequestRow>(
    `SELECT r.id,
            u.name  AS passenger_name,
            r.seats,
            r.pickup_zone_id,
            pz.name AS pickup_zone_name,
            r.destination_zone_id,
            dz.name AS destination_zone_name,
            r.created_at
     FROM   ride_requests r
     JOIN   users u  ON u.id  = r.passenger_id
     JOIN   zones pz ON pz.id = r.pickup_zone_id
     JOIN   zones dz ON dz.id = r.destination_zone_id
     WHERE  r.status = 'REQUESTED'
       AND  r.pickup_zone_id = $1
     ORDER  BY r.created_at DESC`,
    [zoneId],
  )
  return rows
}

export interface BoardingMemberRow {
  id: string
  status: string
  seats: number
  quoted_fare_paisa: number
  distance_km: number | null
}

/**
 * Locks every MATCHED booking in the pool, ready to board. `FOR UPDATE OF r`
 * is required: Postgres refuses a plain FOR UPDATE across the nullable side of
 * an outer join.
 */
export async function lockMatchedMembers(
  tx: PoolClient,
  poolId: string,
): Promise<BoardingMemberRow[]> {
  const { rows } = await tx.query<Omit<BoardingMemberRow, 'distance_km'> & { distance_km: string | null }>(
    `SELECT r.id, r.status, r.seats, r.quoted_fare_paisa, zd.distance_km
     FROM   ride_requests r
     LEFT JOIN zone_distances zd
            ON zd.from_zone_id = r.pickup_zone_id
           AND zd.to_zone_id   = r.destination_zone_id
     WHERE  r.pool_id = $1
       AND  r.status  = 'MATCHED'
     ORDER  BY r.id
     FOR UPDATE OF r`,
    [poolId],
  )
  return rows.map(r => ({
    ...r,
    distance_km: r.distance_km === null ? null : Number(r.distance_km),
  }))
}

export async function setFinalFare(
  tx: PoolClient,
  rideId: string,
  finalFarePaisa: number,
): Promise<void> {
  await tx.query(
    `UPDATE ride_requests SET final_fare_paisa = $2 WHERE id = $1`,
    [rideId, finalFarePaisa],
  )
}

/** Passengers still aboard — blocks completing the trip. */
export async function countPickedUpInPool(tx: PoolClient, poolId: string): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ride_requests
     WHERE pool_id = $1 AND status = 'PICKED_UP'`,
    [poolId],
  )
  return parseInt(rows[0].count, 10)
}

/** Every booking ever attached to the pool, whatever its status. */
export async function countAllBookingsInPool(tx: PoolClient, poolId: string): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ride_requests WHERE pool_id = $1`,
    [poolId],
  )
  return parseInt(rows[0].count, 10)
}

export async function countActivePassengersInPool(tx: PoolClient, poolId: string): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ride_requests
     WHERE pool_id = $1 AND status IN ('MATCHED','PICKED_UP')`,
    [poolId],
  )
  return parseInt(rows[0].count, 10)
}
