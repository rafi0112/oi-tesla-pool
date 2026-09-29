import { Pool, PoolClient } from 'pg'
import { config } from '../config'

// Local Postgres (docker-compose) needs no TLS. A managed host reached over
// the network — Supabase included — refuses a plaintext connection, and its
// certificate is signed by a CA `pg` doesn't ship, so verification is turned
// off rather than left to fail closed. DATABASE_URL alone decides this: point
// it at Supabase's connection string and nothing else has to change.
const isLocal = /^(localhost|127\.0\.0\.1|::1)$/.test(new URL(config.databaseUrl).hostname)

export const db = new Pool({
  connectionString: config.databaseUrl,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
})

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
