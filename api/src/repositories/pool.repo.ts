import { PoolClient } from 'pg'
import { db } from '../db/pool'
import { Gender } from './user.repo'

const ACTIVE_POOL_STATUSES = ['FORMING', 'ACCEPTED', 'DRIVER_ARRIVED', 'EN_ROUTE']
const FINISHED_POOL_STATUSES = ['COMPLETED', 'CANCELLED']

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
  // Null: not accepting new joins. A timestamp: the live deadline — the
  // earliest wait any current member asked for, ratcheted down as more join.
  wait_until: string | null
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
  passenger_gender: Gender
  seats: number
  status: string
  pickup_zone_id: number
  pickup_zone_name: string
  destination_zone_id: number
  destination_zone_name: string
  quoted_fare_paisa: number
  bonus_paisa: number
  final_fare_paisa: number | null
  distance_km: number | null
}

interface RawPoolMemberRow extends Omit<PoolMemberRow, 'distance_km'> {
  distance_km: string | null
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

/**
 * A driver has exactly one vehicle (driver_id is UNIQUE), created once at
 * registration — see auth.service.ts's register(). Nothing else ever
 * creates one; there's no separate "add a vehicle" flow.
 */
export async function createVehicle(
  tx: PoolClient,
  data: { driverId: string; name: string; seatCapacity: number },
): Promise<VehicleRow> {
  const { rows } = await tx.query<VehicleRow>(
    `INSERT INTO vehicles (driver_id, name, seat_capacity)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.driverId, data.name, data.seatCapacity],
  )
  return rows[0]
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
 * Every pool this driver has ever finished, one way or another — the driver's
 * own trip history. Scoped by v.driver_id, taken from the caller's own token
 * (see driver.service.ts), never from a request parameter, so one driver can
 * never see another's. Newest first, same ordering as a passenger's own
 * findRidesByPassenger.
 */
export async function findPoolHistoryByDriver(driverId: string): Promise<PoolRow[]> {
  const { rows } = await db.query<PoolRow>(
    `${SELECT_POOL} WHERE v.driver_id = $1 AND p.status = ANY($2) ORDER BY p.created_at DESC`,
    [driverId, FINISHED_POOL_STATUSES],
  )
  return rows
}

/**
 * FORMING pools open in this pickup zone — candidates a passenger booking from
 * here could self-join. Deliberately excludes ACCEPTED: that status means the
 * pool either never had anyone ask to wait (wait_until null from the start)
 * or was explicitly closed (POST /pools/:id/close), and either way is not
 * "still assembling".
 */
export async function findFormingPoolsByOriginZone(zoneId: number): Promise<PoolRow[]> {
  const { rows } = await db.query<PoolRow>(
    `${SELECT_POOL} WHERE p.origin_zone_id = $1 AND p.status = 'FORMING' ORDER BY p.created_at`,
    [zoneId],
  )
  return rows
}

export async function findPoolMembers(poolId: string): Promise<PoolMemberRow[]> {
  const { rows } = await db.query<RawPoolMemberRow>(
    `SELECT r.id            AS ride_id,
            u.name          AS passenger_name,
            u.gender        AS passenger_gender,
            r.seats,
            r.status,
            r.pickup_zone_id,
            pz.name         AS pickup_zone_name,
            r.destination_zone_id,
            dz.name         AS destination_zone_name,
            r.quoted_fare_paisa,
            r.bonus_paisa,
            r.final_fare_paisa,
            zd.distance_km
     FROM   ride_requests r
     JOIN   users u  ON u.id  = r.passenger_id
     JOIN   zones pz ON pz.id = r.pickup_zone_id
     JOIN   zones dz ON dz.id = r.destination_zone_id
     LEFT JOIN zone_distances zd
            ON zd.from_zone_id = r.pickup_zone_id
           AND zd.to_zone_id   = r.destination_zone_id
     WHERE  r.pool_id = $1
       AND  r.status IN ('MATCHED','PICKED_UP','DROPPED_OFF')
     ORDER  BY r.created_at`,
    [poolId],
  )
  return rows.map(r => ({ ...r, distance_km: r.distance_km === null ? null : Number(r.distance_km) }))
}

export async function createPool(
  tx: PoolClient,
  data: {
    vehicleId: string
    originZoneId: number
    seatsAvailable: number
    status: string
    waitUntil: Date | null
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pools (vehicle_id, origin_zone_id, seats_available, status, wait_until)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [data.vehicleId, data.originZoneId, data.seatsAvailable, data.status, data.waitUntil],
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
 * A joining passenger's own wait preference can only shorten the pool's
 * deadline, never extend it — LEAST() keeps whichever of the current deadline
 * or this candidate comes first. Call only while the pool is FORMING; by the
 * time a join reaches here canJoin has already confirmed wait_until is set.
 */
export async function ratchetWaitUntil(
  tx: PoolClient,
  poolId: string,
  candidate: Date,
): Promise<void> {
  await tx.query(
    `UPDATE pools
        SET wait_until = LEAST(wait_until, $2)
      WHERE id = $1
        AND status = 'FORMING'`,
    [poolId, candidate],
  )
}

/** Ends the assembling window immediately — no further joins, whatever the clock says. */
export async function clearWaitUntil(tx: PoolClient, poolId: string): Promise<void> {
  await tx.query(`UPDATE pools SET wait_until = NULL WHERE id = $1`, [poolId])
}

/**
 * The "I'm in a hurry" button: halves whatever time is actually left on the
 * pool's wait window, right now — not half of the original window, half of
 * what remains. Only takes effect while the pool is still FORMING and
 * genuinely has time left; a caller acting on a stale view (window already
 * closed) gets no row back rather than reopening a closed pool. Every current
 * member reads the same wait_until off this one pool row, so the shortened
 * timer is visible to all of them the moment they next poll — nothing is
 * pushed to them individually.
 */
export async function halveWaitUntil(tx: PoolClient, poolId: string): Promise<string | null> {
  const { rows } = await tx.query<{ wait_until: string }>(
    `UPDATE pools
        SET wait_until = now() + (wait_until - now()) / 2
      WHERE id = $1
        AND status = 'FORMING'
        AND wait_until IS NOT NULL
        AND wait_until > now()
      RETURNING wait_until`,
    [poolId],
  )
  return rows[0]?.wait_until ?? null
}

export interface SeatClaim {
  seatsAvailable: number
  status: string
}

/**
 * The atomic seat claim. One conditional UPDATE — never read-then-write.
 * Returns null when the seats were already taken or the pool closed, which
 * the caller translates into POOL_FULL. Returns the pool's status and its
 * seats_available *after* this claim — the caller uses that to notice a pool
 * has just gone from having room to being full, without a second query.
 */
export async function claimSeats(
  tx: PoolClient,
  poolId: string,
  seats: number,
): Promise<SeatClaim | null> {
  const { rows } = await tx.query<{ seats_available: number; status: string }>(
    `UPDATE pools
        SET seats_available = seats_available - $2
      WHERE id = $1
        AND seats_available >= $2
        AND status IN ('FORMING','ACCEPTED')
      RETURNING seats_available, status`,
    [poolId, seats],
  )
  return rows[0] ? { seatsAvailable: rows[0].seats_available, status: rows[0].status } : null
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
