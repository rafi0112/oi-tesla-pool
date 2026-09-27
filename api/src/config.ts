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

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  jwtSecret:   requireEnv('JWT_SECRET'),
  port:        parseInt(process.env['API_PORT'] ?? '4000', 10),
  nodeEnv:     process.env['NODE_ENV'] ?? 'development',
}
