import { PoolClient } from 'pg'
import { db } from '../db/pool'

export interface UserRow {
  id: string
  name: string
  email: string
  password_hash: string
  role: 'PASSENGER' | 'DRIVER'
  is_online: boolean
  current_zone_id: number | null
  created_at: string
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT * FROM users WHERE email = $1`,
    [email],
  )
  return rows[0] ?? null
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT * FROM users WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function createUser(
  tx: PoolClient,
  data: { name: string; email: string; passwordHash: string; role: 'PASSENGER' | 'DRIVER' },
): Promise<UserRow> {
  const { rows } = await tx.query<UserRow>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.name, data.email, data.passwordHash, data.role],
  )
  return rows[0]
}
