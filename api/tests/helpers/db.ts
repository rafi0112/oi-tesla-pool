import argon2 from 'argon2'
import { db } from '../../src/db/pool'
import { ZONES, DISTANCES, VEHICLE, SEED_PASSWORD } from '../../src/db/seedData'

export const TEST_PASSWORD = SEED_PASSWORD

/**
 * Wipes every table. Tests own the database outright, so a run clears whatever
 * `npm run seed` left behind — re-seed afterwards if you want the demo data back.
 */
export async function truncateAll(): Promise<void> {
  await db.query(`
    TRUNCATE ride_status_events, pool_status_events, ride_requests, pools,
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
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'DRIVER') RETURNING id`,
    ['Jashim Uddin', 'jashim@oitesla.test', hash],
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
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'PASSENGER') RETURNING id`,
      [name, email, hash],
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
