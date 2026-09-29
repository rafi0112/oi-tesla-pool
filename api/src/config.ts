import path from 'path'
import dotenv from 'dotenv'

// .env lives at the repo root, shared with docker-compose, but npm scripts run
// from api/. Resolve it explicitly rather than relying on the working directory.
// In Docker the variables are supplied directly and the missing file is a no-op.
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

const nodeEnv = process.env['NODE_ENV'] ?? 'development'

/**
 * Tests truncate every table, so they must never point at the development
 * database. Under NODE_ENV=test the connection is redirected to TEST_DATABASE_URL,
 * defaulting to the dev database's name with a _test suffix.
 */
function resolveDatabaseUrl(): string {
  const primary = requireEnv('DATABASE_URL')
  if (nodeEnv !== 'test') return primary
  return process.env['TEST_DATABASE_URL'] ?? deriveTestUrl(primary)
}

export function deriveTestUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `${url.pathname.replace(/^\//, '')}_test`
  return url.toString()
}

export const config = {
  databaseUrl: resolveDatabaseUrl(),
  port:        parseInt(process.env['API_PORT'] ?? '4000', 10),
  nodeEnv,
  // Auth is now Supabase's own — the anon key verifies a token the same way
  // the browser's supabase-js client would; the service role key is only
  // used server-side, for admin actions like creating the demo cast (see
  // db/seedAuth.ts), and must never reach the frontend bundle.
  supabaseUrl:            requireEnv('SUPABASE_URL'),
  supabaseAnonKey:        requireEnv('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
}
