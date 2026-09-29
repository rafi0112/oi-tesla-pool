import { PoolClient } from 'pg'
import { db } from '../db/pool'

export type Gender = 'MALE' | 'FEMALE' | 'OTHER'

export interface UserRow {
  id: string
  name: string
  email: string
  role: 'PASSENGER' | 'DRIVER'
  gender: Gender
  is_online: boolean
  current_zone_id: number | null
  /** False only for a fresh OAuth sign-in — see completeProfile below. */
  profile_completed: boolean
  created_at: string
}

/**
 * id is always a Supabase Auth id (auth.users.id) — this row only exists
 * because the on_auth_user_created trigger (migration 007) created it the
 * instant Supabase Auth created the matching auth.users row. There is no
 * createUser here any more: this app never inserts a user directly, whether
 * that's email/password signup or an OAuth provider.
 */
export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT * FROM users WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function updateDriverAvailability(
  driverId: string,
  isOnline: boolean,
  zoneId: number | null,
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users
        SET is_online = $2, current_zone_id = $3
      WHERE id = $1
      RETURNING *`,
    [driverId, isOnline, zoneId],
  )
  return rows[0]
}

/**
 * Anything that can run a query — the shared pool, or a transaction client.
 * Passengers have no online/offline gate the way drivers do, so setting their
 * location is just this one column, and it needs to work both standalone (an
 * explicit "set my location" action) and inside a booking's own transaction
 * (kept in sync automatically every time they request a ride).
 */
type Queryable = Pick<PoolClient, 'query'>

export async function updateUserZone(
  userId: string,
  zoneId: number | null,
  exec: Queryable = db as unknown as Queryable,
): Promise<UserRow> {
  const { rows } = await exec.query<UserRow>(
    `UPDATE users SET current_zone_id = $2 WHERE id = $1 RETURNING *`,
    [userId, zoneId],
  )
  return rows[0]
}

/**
 * Fills in what an OAuth sign-in couldn't supply (Google/LinkedIn give no
 * way to collect role, gender, or a driver's vehicle at sign-in time) — see
 * POST /auth/complete-profile. Only ever touches this one user's own row.
 */
export async function completeProfile(
  userId: string,
  data: { role: 'PASSENGER' | 'DRIVER'; gender: Gender },
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users SET role = $2, gender = $3, profile_completed = true WHERE id = $1 RETURNING *`,
    [userId, data.role, data.gender],
  )
  return rows[0]
}
