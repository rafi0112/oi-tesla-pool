import argon2 from 'argon2'
import { db } from './pool'

const PASSWORD = 'Password123!'

const USERS = [
  { name: 'Jashim Uddin',  email: 'jashim@oitesla.test',  role: 'DRIVER'    },
  { name: 'Nusrat Jahan',  email: 'nusrat@oitesla.test',  role: 'PASSENGER' },
  { name: 'Rafiq Hasan',   email: 'rafiq@oitesla.test',   role: 'PASSENGER' },
  { name: 'Shirin Akter',  email: 'shirin@oitesla.test',  role: 'PASSENGER' },
]

const ZONES = [
  { name: 'Banani',       lat: 23.793700, lng: 90.406600 },
  { name: 'Gulshan 1',    lat: 23.780800, lng: 90.415400 },
  { name: 'Mohakhali',    lat: 23.777900, lng: 90.399700 },
  { name: 'Dhanmondi',    lat: 23.746100, lng: 90.374200 },
  { name: 'Mirpur',       lat: 23.822300, lng: 90.365400 },
  { name: 'Uttara',       lat: 23.875900, lng: 90.379500 },
  { name: 'Farmgate',     lat: 23.756900, lng: 90.389300 },
  { name: 'Bashundhara',  lat: 23.814100, lng: 90.424300 },
]

// Distances in km — every pair inserted in both directions
const DISTANCES: [string, string, number][] = [
  ['Banani',      'Gulshan 1',   4.0],
  ['Banani',      'Mohakhali',   3.0],
  ['Banani',      'Dhanmondi',   8.0],
  ['Banani',      'Mirpur',      7.0],
  ['Banani',      'Uttara',      9.0],
  ['Banani',      'Farmgate',    6.0],
  ['Banani',      'Bashundhara', 6.5],
  ['Gulshan 1',   'Mohakhali',   2.0],
  ['Gulshan 1',   'Dhanmondi',   9.0],
  ['Gulshan 1',   'Mirpur',      9.5],
  ['Gulshan 1',   'Uttara',     11.0],
  ['Gulshan 1',   'Farmgate',    7.0],
  ['Gulshan 1',   'Bashundhara', 5.0],
  ['Mohakhali',   'Dhanmondi',   6.5],
  ['Mohakhali',   'Mirpur',      7.5],
  ['Mohakhali',   'Uttara',     11.5],
  ['Mohakhali',   'Farmgate',    4.0],
  ['Mohakhali',   'Bashundhara', 7.0],
  ['Dhanmondi',   'Mirpur',      8.0],
  ['Dhanmondi',   'Uttara',     16.0],
  ['Dhanmondi',   'Farmgate',    3.5],
  ['Dhanmondi',   'Bashundhara',12.0],
  ['Mirpur',      'Uttara',     12.0],
  ['Mirpur',      'Farmgate',    6.0],
  ['Mirpur',      'Bashundhara',13.0],
  ['Uttara',      'Farmgate',   14.0],
  ['Uttara',      'Bashundhara', 8.0],
  ['Farmgate',    'Bashundhara',10.0],
]

async function seed() {
  const client = await db.connect()
  try {
    const hash = await argon2.hash(PASSWORD)

    // Users
    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE
           SET name = EXCLUDED.name, role = EXCLUDED.role`,
        [u.name, u.email, hash, u.role]
      )
    }
    console.log('seeded users')

    // Zones
    for (const z of ZONES) {
      await client.query(
        `INSERT INTO zones (name, lat, lng)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE
           SET lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
        [z.name, z.lat, z.lng]
      )
    }
    console.log('seeded zones')

    // Zone distances (both directions)
    for (const [from, to, km] of DISTANCES) {
      const ids = await client.query<{ id: number; name: string }>(
        `SELECT id, name FROM zones WHERE name = ANY($1)`,
        [[from, to]]
      )
      const map = Object.fromEntries(ids.rows.map(r => [r.name, r.id]))
      const fromId = map[from]
      const toId   = map[to]

      for (const [a, b] of [[fromId, toId], [toId, fromId]]) {
        await client.query(
          `INSERT INTO zone_distances (from_zone_id, to_zone_id, distance_km)
           VALUES ($1, $2, $3)
           ON CONFLICT (from_zone_id, to_zone_id) DO UPDATE
             SET distance_km = EXCLUDED.distance_km`,
          [a, b, km]
        )
      }
    }
    console.log('seeded zone_distances')

    // Vehicle — Bullet, owned by Jashim
    const jashim = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      ['jashim@oitesla.test']
    )
    const jashimId = jashim.rows[0].id
    await client.query(
      `INSERT INTO vehicles (driver_id, name, seat_capacity)
       VALUES ($1, $2, $3)
       ON CONFLICT (driver_id) DO UPDATE
         SET name = EXCLUDED.name, seat_capacity = EXCLUDED.seat_capacity`,
      [jashimId, 'Bullet', 3]
    )
    console.log('seeded vehicle: Bullet')

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
