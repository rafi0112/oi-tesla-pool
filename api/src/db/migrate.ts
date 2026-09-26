import fs from 'fs'
import path from 'path'
import { db } from './pool'

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations')

async function migrate() {
  const client = await db.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const applied = await client.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY name'
    )
    const appliedNames = new Set(applied.rows.map(r => r.name))

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (appliedNames.has(file)) {
        console.log(`skipped  ${file}`)
        continue
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`applied  ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`failed   ${file}:`, err)
        process.exit(1)
      }
    }

    console.log('migrations done')
  } finally {
    client.release()
    await db.end()
  }
}

migrate()
