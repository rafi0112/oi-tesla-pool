import { PoolClient } from 'pg'
import { db } from '../db/pool'
import { Gender } from './user.repo'

export interface RideRow {
  id: string
  passenger_id: string
  pool_id: string | null
  pickup_zone_id: number
  pickup_zone_name: string
  destination_zone_id: number
  destination_zone_name: string
  seats: number
  /** Minutes this passenger is willing to have the pool wait for more riders. */
  wait_minutes: number
  quoted_fare_paisa: number
  /** What this passenger chose to add on top, to attract a driver faster — already folded into quoted_fare_paisa. */
  bonus_paisa: number
  final_fare_paisa: number | null
  status: string
  idempotency_key: string | null
  created_at: string
  /** Trip length, used to recompute the displayed fare from live membership. */
  distance_km: number | null
  /** Other active bookings sharing this ride's pool — excludes this row. */
  shared_with: number
  /**
   * Gender of every other booking that ever rode along in this ride's pool
   * (matched, on board, or already dropped off) — excludes this row, and
   * deliberately never carries a name: one passenger must never learn
   * another's identity, only that someone of this gender shared the ride.
   * Feeds both the live "Sharing" detail and the past-ride history, unlike
   * shared_with, which only counts bookings still active (see
   * ACTIVE_IN_POOL in passenger.dto.ts) since dropped-off fares are already
   * locked and must not move.
   */
  shared_genders: Gender[]
  /** Null until the ride is matched to a pool. */
  driver_name: string | null
  vehicle_name: string | null
  /** Null until the passenger rates this ride — only possible once DROPPED_OFF. */
  feedback: FeedbackRow | null
  /** The reason the most recent CANCELLED transition recorded — null if never cancelled. */
  cancel_reason: string | null
  /**
   * The pool's own wait deadline — null once it's no longer accepting new
   * joins (closed, expired, or never opened). Every current member sees this
   * same value, so it's how "all the pool members can see that timer" holds:
   * it isn't copied per rider, it's read live off the one pool row they share.
   */
  pool_wait_until: string | null
}

export interface FeedbackRow {
  rating: number
  comment: string | null
  createdAt: string
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
         drv.name AS driver_name,
         veh.name AS vehicle_name,
         (SELECT COUNT(*)
            FROM ride_requests peer
           WHERE peer.pool_id = r.pool_id
             AND peer.id <> r.id
             AND peer.status IN ('MATCHED','PICKED_UP')) AS shared_with,
         (SELECT COALESCE(array_agg(pu.gender ORDER BY pu.gender), '{}')
            FROM ride_requests peer
            JOIN users pu ON pu.id = peer.passenger_id
           WHERE peer.pool_id = r.pool_id
             AND peer.id <> r.id
             AND peer.status IN ('MATCHED','PICKED_UP','DROPPED_OFF')) AS shared_genders,
         (SELECT json_build_object('rating', f.rating, 'comment', f.comment, 'createdAt', f.created_at)
            FROM ride_feedback f
           WHERE f.ride_request_id = r.id) AS feedback,
         (SELECT e.reason
            FROM ride_status_events e
           WHERE e.ride_request_id = r.id AND e.to_status = 'CANCELLED'
           ORDER BY e.created_at DESC LIMIT 1) AS cancel_reason,
         pl.wait_until AS pool_wait_until
  FROM   ride_requests r
  JOIN   zones pz ON pz.id = r.pickup_zone_id
  JOIN   zones dz ON dz.id = r.destination_zone_id
  LEFT JOIN zone_distances zd
         ON zd.from_zone_id = r.pickup_zone_id
        AND zd.to_zone_id   = r.destination_zone_id
  LEFT JOIN pools    pl  ON pl.id  = r.pool_id
  LEFT JOIN vehicles veh ON veh.id = pl.vehicle_id
  LEFT JOIN users    drv ON drv.id = veh.driver_id
`

function mapRide(r: RawRideRow): RideRow {
  return {
    ...r,
    distance_km: r.distance_km === null ? null : Number(r.distance_km),
    shared_with: Number(r.shared_with),
  }
}

/**
 * Anything that can run a query — the shared pool, or a transaction client.
 * A row written inside an open transaction is invisible to the pool, so reads
 * that must see uncommitted writes have to pass the client through.
 */
type Queryable = Pick<PoolClient, 'query'>

export async function findRideById(
  id: string,
  passengerId?: string,
  exec: Queryable = db as unknown as Queryable,
): Promise<RideRow | null> {
  const where = passengerId
    ? `WHERE r.id = $1 AND r.passenger_id = $2`
    : `WHERE r.id = $1`
  const params = passengerId ? [id, passengerId] : [id]
  const { rows } = await exec.query<RawRideRow>(`${SELECT_RIDE} ${where}`, params)
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

/**
 * This passenger's one active ride, if any — mirrors the condition behind
 * one_active_ride_per_passenger (assumption 7). Used only to self-heal a
 * stale REQUESTED ride before a new booking attempt (see requestRide in
 * ride.service.ts), so "book again after 15 minutes" works immediately
 * without the passenger first having to open their ride list.
 */
export async function findActiveRideByPassenger(passengerId: string): Promise<RideRow | null> {
  const { rows } = await db.query<RawRideRow>(
    `${SELECT_RIDE} WHERE r.passenger_id = $1 AND r.status IN ('REQUESTED','MATCHED','PICKED_UP')`,
    [passengerId],
  )
  return rows[0] ? mapRide(rows[0]) : null
}

/** True while this passenger currently has a MATCHED (waiting-to-board) booking in this pool. */
export async function isMatchedInPool(passengerId: string, poolId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM ride_requests
      WHERE pool_id = $1 AND passenger_id = $2 AND status = 'MATCHED'
      LIMIT 1`,
    [poolId, passengerId],
  )
  return rows.length > 0
}

export async function createRide(
  tx: PoolClient,
  data: {
    passengerId: string
    pickupZoneId: number
    destinationZoneId: number
    seats: number
    waitMinutes: number
    quotedFarePaisa: number
    bonusPaisa: number
    idempotencyKey: string | null
  },
): Promise<RideRow> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO ride_requests
       (passenger_id, pickup_zone_id, destination_zone_id, seats, wait_minutes, quoted_fare_paisa, bonus_paisa, status, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'REQUESTED', $8)
     RETURNING id`,
    [
      data.passengerId, data.pickupZoneId, data.destinationZoneId, data.seats,
      data.waitMinutes, data.quotedFarePaisa, data.bonusPaisa, data.idempotencyKey,
    ],
  )
  // Read back through the same client — the insert is not committed yet.
  const ride = await findRideById(rows[0].id, undefined, tx)
  if (!ride) throw new Error('inserted ride could not be read back')
  return ride
}

export interface RideCoreRow {
  id: string
  passenger_id: string
  pool_id: string | null
  pickup_zone_id: number
  destination_zone_id: number
  seats: number
  wait_minutes: number
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
    `SELECT id, passenger_id, pool_id, pickup_zone_id, destination_zone_id, seats, wait_minutes, status
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
  wait_minutes: number
  pickup_zone_id: number
  pickup_zone_name: string
  destination_zone_id: number
  destination_zone_name: string
  quoted_fare_paisa: number
  bonus_paisa: number
  distance_km: number | null
  created_at: string
}

interface RawOpenRequestRow extends Omit<OpenRequestRow, 'distance_km'> {
  distance_km: string | null
}

/**
 * Served by the open_requests_by_zone partial index. Ordered by bonus first —
 * a passenger who offered more to attract a driver surfaces at the top of
 * every driver's feed in that zone, not just wherever created_at happens to
 * place them.
 */
export async function findOpenRequestsInZone(zoneId: number): Promise<OpenRequestRow[]> {
  const { rows } = await db.query<RawOpenRequestRow>(
    `SELECT r.id,
            u.name  AS passenger_name,
            r.seats,
            r.wait_minutes,
            r.pickup_zone_id,
            pz.name AS pickup_zone_name,
            r.destination_zone_id,
            dz.name AS destination_zone_name,
            r.quoted_fare_paisa,
            r.bonus_paisa,
            zd.distance_km,
            r.created_at
     FROM   ride_requests r
     JOIN   users u  ON u.id  = r.passenger_id
     JOIN   zones pz ON pz.id = r.pickup_zone_id
     JOIN   zones dz ON dz.id = r.destination_zone_id
     LEFT JOIN zone_distances zd
            ON zd.from_zone_id = r.pickup_zone_id
           AND zd.to_zone_id   = r.destination_zone_id
     WHERE  r.status = 'REQUESTED'
       AND  r.pickup_zone_id = $1
     ORDER  BY r.bonus_paisa DESC, r.created_at DESC`,
    [zoneId],
  )
  return rows.map(r => ({ ...r, distance_km: r.distance_km === null ? null : Number(r.distance_km) }))
}

/** Every fare permanently earned by this driver — summed once a ride is fully dropped off. */
export async function sumDriverEarnings(driverId: string): Promise<number> {
  const { rows } = await db.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(r.final_fare_paisa), 0) AS total
     FROM   ride_requests r
     JOIN   pools    p ON p.id = r.pool_id
     JOIN   vehicles v ON v.id = p.vehicle_id
     WHERE  v.driver_id = $1
       AND  r.status = 'DROPPED_OFF'`,
    [driverId],
  )
  return Number(rows[0].total)
}

export interface BoardingMemberRow {
  id: string
  status: string
  seats: number
  quoted_fare_paisa: number
  bonus_paisa: number
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
    `SELECT r.id, r.status, r.seats, r.quoted_fare_paisa, r.bonus_paisa, zd.distance_km
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
