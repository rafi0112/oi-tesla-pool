import argon2 from 'argon2'
import { db } from '../../src/db/pool'
import { config } from '../../src/config'
import { ZONES, DISTANCES, VEHICLE, SEED_PASSWORD, USERS } from '../../src/db/seedData'

/** Falls back to 'OTHER' for a test-only name that isn't part of the story cast. */
function genderFor(name: string): string {
  return USERS.find(u => u.name === name)?.gender ?? 'OTHER'
}

export const TEST_PASSWORD = SEED_PASSWORD

// Last line of defence: truncation is destructive, so verify the target database
// really is the test one before touching it, whatever the config says.
const TARGET = new URL(config.databaseUrl).pathname.replace(/^\//, '')
if (!TARGET.endsWith('_test')) {
  throw new Error(`Refusing to truncate "${TARGET}" — tests only run against a _test database`)
}

/** Wipes every table. Safe: the guard above proves this is the test database. */
export async function truncateAll(): Promise<void> {
  await db.query(`
    TRUNCATE ride_feedback, ride_status_events, pool_status_events, ride_requests, pools,
             zone_distances, vehicles, users, zones
    RESTART IDENTITY CASCADE
  `)
}

export interface TestWorld {
  zoneId: (name: string) => number
  driverId: string
  vehicleId: string
  passengers: Record<string, string>
}

/** Inserts the zones, distance matrix, one driver with Bullet, and the passengers named. */
export async function seedWorld(passengerNames: string[]): Promise<TestWorld> {
  const hash = await argon2.hash(TEST_PASSWORD)

  const zoneIds = new Map<string, number>()
  for (const z of ZONES) {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO zones (name, lat, lng) VALUES ($1, $2, $3) RETURNING id`,
      [z.name, z.lat, z.lng],
    )
    zoneIds.set(z.name, rows[0].id)
  }

  for (const [from, to, km] of DISTANCES) {
    const a = zoneIds.get(from)!
    const b = zoneIds.get(to)!
    await db.query(
      `INSERT INTO zone_distances (from_zone_id, to_zone_id, distance_km)
       VALUES ($1, $2, $3), ($2, $1, $3)`,
      [a, b, km],
    )
  }

  const { rows: driverRows } = await db.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, gender)
     VALUES ($1, $2, $3, 'DRIVER', $4) RETURNING id`,
    ['Jashim Uddin', 'jashim@oitesla.test', hash, genderFor('Jashim Uddin')],
  )
  const driverId = driverRows[0].id

  const { rows: vehicleRows } = await db.query<{ id: string }>(
    `INSERT INTO vehicles (driver_id, name, seat_capacity)
     VALUES ($1, $2, $3) RETURNING id`,
    [driverId, VEHICLE.name, VEHICLE.seatCapacity],
  )

  const passengers: Record<string, string> = {}
  for (const name of passengerNames) {
    const email = `${name.split(' ')[0].toLowerCase()}@oitesla.test`
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, gender)
       VALUES ($1, $2, $3, 'PASSENGER', $4) RETURNING id`,
      [name, email, hash, genderFor(name)],
    )
    passengers[name] = rows[0].id
  }

  return {
    zoneId: (name: string) => {
      const id = zoneIds.get(name)
      if (id === undefined) throw new Error(`Unknown zone: ${name}`)
      return id
    },
    driverId,
    vehicleId: vehicleRows[0].id,
    passengers,
  }
}

/**
 * Adds a second (or third, …) driver with their own vehicle, on top of
 * seedWorld's own — for tests that need to prove one driver's data is scoped
 * away from another's. Login as this driver with tokenFor(name), same as any
 * seedWorld driver or passenger.
 */
export async function addDriver(name: string, vehicleName = 'Rocket'): Promise<{ driverId: string; vehicleId: string }> {
  const hash = await argon2.hash(TEST_PASSWORD)
  const email = `${name.split(' ')[0].toLowerCase()}@oitesla.test`

  const { rows: driverRows } = await db.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role, gender)
     VALUES ($1, $2, $3, 'DRIVER', $4) RETURNING id`,
    [name, email, hash, genderFor(name)],
  )
  const driverId = driverRows[0].id

  const { rows: vehicleRows } = await db.query<{ id: string }>(
    `INSERT INTO vehicles (driver_id, name, seat_capacity)
     VALUES ($1, $2, 3) RETURNING id`,
    [driverId, vehicleName],
  )

  return { driverId, vehicleId: vehicleRows[0].id }
}

export async function seatsAvailable(poolId: string): Promise<number> {
  const { rows } = await db.query<{ seats_available: number }>(
    `SELECT seats_available FROM pools WHERE id = $1`,
    [poolId],
  )
  return rows[0].seats_available
}

export async function poolStatus(poolId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(
    `SELECT status FROM pools WHERE id = $1`,
    [poolId],
  )
  return rows[0].status
}

/** Backdates a pool's deadline into the past, so tests don't wait for real minutes to pass. */
export async function expirePoolWait(poolId: string): Promise<void> {
  await db.query(
    `UPDATE pools SET wait_until = now() - interval '1 second' WHERE id = $1`,
    [poolId],
  )
}

export async function poolWaitUntil(poolId: string): Promise<string | null> {
  const { rows } = await db.query<{ wait_until: string | null }>(
    `SELECT wait_until FROM pools WHERE id = $1`,
    [poolId],
  )
  return rows[0].wait_until
}

/** Backdates a ride request's created_at past the 15-minute expiry window, so tests don't wait for real minutes to pass. */
export async function backdateRideRequest(rideId: string): Promise<void> {
  await db.query(
    `UPDATE ride_requests SET created_at = now() - interval '16 minutes' WHERE id = $1`,
    [rideId],
  )
}

export async function poolEventReasons(poolId: string): Promise<string[]> {
  const { rows } = await db.query<{ to_status: string; reason: string | null }>(
    `SELECT to_status, reason FROM pool_status_events
     WHERE pool_id = $1 ORDER BY created_at`,
    [poolId],
  )
  return rows.map(r => `${r.to_status}:${r.reason ?? ''}`)
}

export async function closeDb(): Promise<void> {
  await db.end()
}
