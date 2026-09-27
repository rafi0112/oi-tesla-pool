import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { Client } from 'pg'
import { config } from '../src/config'

/**
 * Creates the test database if it is missing and applies the migrations, once
 * per `vitest run`. Every suite then truncates between tests. Nothing here ever
 * touches the development database beyond connecting to `postgres` to issue
 * CREATE DATABASE.
 */
export async function setup() {
  if (config.nodeEnv !== 'test') {
    throw new Error('Tests must run with NODE_ENV=test so they cannot hit the dev database')
  }

  const testUrl = new URL(config.databaseUrl)
  const dbName = testUrl.pathname.replace(/^\//, '')

  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${dbName}" — the name must end in _test`)
  }

  const admin = new Client({ connectionString: adminUrl(config.databaseUrl) })
  await admin.connect()
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (rowCount === 0) {
      // Identifier, so it cannot be parameterised; the _test suffix check above
      // plus the quoting here keep it safe.
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`)
    }
  } finally {
    await admin.end()
  }

  await migrate(config.databaseUrl)
}

function adminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.pathname = '/postgres'
  return url.toString()
}

async function migrate(databaseUrl: string) {
  const dir = path.resolve(__dirname, '../migrations')

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await client.query<{ name: string }>('SELECT name FROM _migrations')
    const done = new Set(rows.map(r => r.name))

    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue
      await client.query('BEGIN')
      try {
        await client.query(readFileSync(path.join(dir, file), 'utf8'))
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    await client.end()
  }
}
