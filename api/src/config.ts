import dotenv from 'dotenv'
dotenv.config()

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
