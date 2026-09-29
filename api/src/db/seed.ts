import { db } from './pool'
import { ZONES, DISTANCES } from './seedData'

/**
 * World data only — zones and the distance matrix. The story cast (users,
 * and the driver's vehicle) now comes from Supabase Auth via `npm run
 * seed:auth`, not from here: a user row only exists once Supabase Auth has
 * created the matching auth.users row and the on_auth_user_created trigger
 * (migration 007) has copied it into public.users.
 */
async function seed() {
  const client = await db.connect()
  try {
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

    console.log('seed complete — run `npm run seed:auth` for the story cast')
  } finally {
    client.release()
    await db.end()
  }
}

seed().catch(err => {
  console.error('seed failed:', err)
  process.exit(1)
})
