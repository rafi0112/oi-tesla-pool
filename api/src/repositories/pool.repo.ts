import { PoolClient } from 'pg'
import { db } from '../db/pool'

const ACTIVE_POOL_STATUSES = ['FORMING', 'ACCEPTED', 'DRIVER_ARRIVED', 'EN_ROUTE']

export interface PoolRow {
  id: string
  vehicle_id: string
  origin_zone_id: number
  origin_zone_name: string
  seats_available: number
  seat_capacity: number
  vehicle_name: string
  driver_name: string
  status: string
  wait_for_pool: boolean
  created_at: string
}

export interface VehicleRow {
  id: string
  driver_id: string
  name: string
  seat_capacity: number
}

export interface PoolMemberRow {
  ride_id: string
  passenger_name: string
  seats: number
  status: string
  pickup_zone_id: number
  pickup_zone_name: string
  destination_zone_id: number
  destination_zone_name: string
}

const SELECT_POOL = `
  SELECT p.*,
         z.name   AS origin_zone_name,
         v.seat_capacity,
         v.name   AS vehicle_name,
         drv.name AS driver_name
  FROM   pools p
  JOIN   zones    z   ON z.id   = p.origin_zone_id
  JOIN   vehicles v   ON v.id   = p.vehicle_id
  JOIN   users    drv ON drv.id = v.driver_id
`

export async function findVehicleByDriver(driverId: string): Promise<VehicleRow | null> {
  const { rows } = await db.query<VehicleRow>(
    `SELECT * FROM vehicles WHERE driver_id = $1`,
    [driverId],
  )
  return rows[0] ?? null
}

export async function findPoolById(id: string): Promise<PoolRow | null> {
  const { rows } = await db.query<PoolRow>(`${SELECT_POOL} WHERE p.id = $1`, [id])
  return rows[0] ?? null
}

/** Pool lookup scoped to its owning driver — used for ownership checks (404 if not theirs). */
export async function findPoolByIdForDriver(id: string, driverId: string): Promise<PoolRow | null> {
  const { rows } = await db.query<PoolRow>(
    `${SELECT_POOL} WHERE p.id = $1 AND v.driver_id = $2`,
    [id, driverId],
  )
  return rows[0] ?? null
}

export async function findActivePoolByDriver(driverId: string): Promise<PoolRow | null> {
  const { rows } = await db.query<PoolRow>(
    `${SELECT_POOL} WHERE v.driver_id = $1 AND p.status = ANY($2)`,
    [driverId, ACTIVE_POOL_STATUSES],
  )
  return rows[0] ?? null
}

/**
 * FORMING pools open in this pickup zone — candidates a passenger booking from
 * here could self-join. Deliberately excludes ACCEPTED: that status means the
 * driver either never opened a window (waitForPool false) or explicitly closed
 * one (POST /pools/:id/close), and either way is not "still assembling".
 */
export async function findFormingPoolsByOriginZone(zoneId: number): Promise<PoolRow[]> {
  const { rows } = await db.query<PoolRow>(
    `${SELECT_POOL} WHERE p.origin_zone_id = $1 AND p.status = 'FORMING' ORDER BY p.created_at`,
    [zoneId],
  )
  return rows
}

export async function findPoolMembers(poolId: string): Promise<PoolMemberRow[]> {
  const { rows } = await db.query<PoolMemberRow>(
    `SELECT r.id            AS ride_id,
            u.name          AS passenger_name,
            r.seats,
            r.status,
            r.pickup_zone_id,
            pz.name         AS pickup_zone_name,
            r.destination_zone_id,
            dz.name         AS destination_zone_name
     FROM   ride_requests r
     JOIN   users u  ON u.id  = r.passenger_id
     JOIN   zones pz ON pz.id = r.pickup_zone_id
     JOIN   zones dz ON dz.id = r.destination_zone_id
     WHERE  r.pool_id = $1
       AND  r.status IN ('MATCHED','PICKED_UP','DROPPED_OFF')
     ORDER  BY r.created_at`,
    [poolId],
  )
  return rows
}

export async function createPool(
  tx: PoolClient,
  data: {
    vehicleId: string
    originZoneId: number
    seatsAvailable: number
    status: string
    waitForPool: boolean
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, origin_zone_id, seats_available, status, wait_for_pool)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [data.vehicleId, data.originZoneId, data.seatsAvailable, data.status, data.waitForPool],
  )
  return rows[0].id
}

/**
 * Locks the pool row for the rest of the transaction. Concurrent cancellations
 * must serialise here, or each would count the other as still active and neither
 * would auto-cancel the emptied pool.
 */
export async function lockPoolById(
  tx: PoolClient,
  poolId: string,
): Promise<{ id: string; status: string } | null> {
  const { rows } = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM pools WHERE id = $1 FOR UPDATE`,
    [poolId],
  )
  return rows[0] ?? null
}

export async function updatePoolStatus(
  tx: PoolClient,
  poolId: string,
  status: string,
): Promise<void> {
  await tx.query(`UPDATE pools SET status = $2 WHERE id = $1`, [poolId, status])
}

/**
 * The atomic seat claim. One conditional UPDATE — never read-then-write.
 * Returns false when the seats were already taken or the pool closed, which the
 * caller translates into POOL_FULL.
 */
export async function claimSeats(
  tx: PoolClient,
  poolId: string,
  seats: number,
): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE pools
        SET seats_available = seats_available - $2
      WHERE id = $1
        AND seats_available >= $2
        AND status IN ('FORMING','ACCEPTED')`,
    [poolId, seats],
  )
  return rowCount === 1
}

/** Mirrored release on cancellation, guarded so it can never exceed capacity. */
export async function releaseSeats(
  tx: PoolClient,
  poolId: string,
  seats: number,
): Promise<void> {
  await tx.query(
    `UPDATE pools p
        SET seats_available = p.seats_available + $2
       FROM vehicles v
      WHERE p.id = $1
        AND v.id = p.vehicle_id
        AND p.seats_available + $2 <= v.seat_capacity`,
    [poolId, seats],
  )
}
