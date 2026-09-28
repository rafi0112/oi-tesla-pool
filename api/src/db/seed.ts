import argon2 from 'argon2'
import { db } from './pool'
import { SEED_PASSWORD, USERS, VEHICLE, ZONES, DISTANCES } from './seedData'

async function seed() {
  const client = await db.connect()
  try {
    const hash = await argon2.hash(SEED_PASSWORD)

    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (name, email, password_hash, role, gender)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE
           SET name = EXCLUDED.name, role = EXCLUDED.role, gender = EXCLUDED.gender`,
        [u.name, u.email, hash, u.role, u.gender],
      )
    }
    console.log('seeded users')

    for (const z of ZONES) {
      await client.query(
        `INSERT INTO zones (name, lat, lng)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE
           SET lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
        [z.name, z.lat, z.lng],
      )
    }
    console.log('seeded zones')

    const { rows: zoneRows } = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM zones`,
    )
    const zoneId = new Map(zoneRows.map(r => [r.name, r.id]))

    for (const [from, to, km] of DISTANCES) {
      const a = zoneId.get(from)!
      const b = zoneId.get(to)!
      for (const [x, y] of [[a, b], [b, a]]) {
        await client.query(
          `INSERT INTO zone_distances (from_zone_id, to_zone_id, distance_km)
           VALUES ($1, $2, $3)
           ON CONFLICT (from_zone_id, to_zone_id) DO UPDATE
             SET distance_km = EXCLUDED.distance_km`,
          [x, y, km],
        )
      }
    }
    console.log('seeded zone_distances')

    const { rows: driverRows } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [USERS[0].email],
    )
    await client.query(
      `INSERT INTO vehicles (driver_id, name, seat_capacity)
       VALUES ($1, $2, $3)
       ON CONFLICT (driver_id) DO UPDATE
         SET name = EXCLUDED.name, seat_capacity = EXCLUDED.seat_capacity`,
      [driverRows[0].id, VEHICLE.name, VEHICLE.seatCapacity],
    )
    console.log(`seeded vehicle: ${VEHICLE.name}`)

    console.log('seed complete')
  } finally {
    client.release()
    await db.end()
  }
}

seed().catch(err => {
  console.error('seed failed:', err)
  process.exit(1)
})
