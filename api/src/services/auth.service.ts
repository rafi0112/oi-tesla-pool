import { z } from 'zod'
import { findUserById, completeProfile as completeProfileRow } from '../repositories/user.repo'
import { createVehicle } from '../repositories/pool.repo'
import { withTransaction } from '../db/pool'
import { POOL_POLICY } from '../domain/matching'
import { NotFoundError, ValidationError } from '../errors'

// Signup itself is Supabase Auth's job now (supabase-js signUp() /
// signInWithOAuth() on the frontend) — this service only ever reads or
// completes a profile that already exists, created by the
// on_auth_user_created trigger the moment Supabase Auth creates the user.

export type UserDTO = {
  id: string
  name: string
  email: string
  role: string
  gender: string
  /** False only for a fresh OAuth sign-in — the frontend routes to a short setup step until this is true. */
  profileCompleted: boolean
}

function toDTO(u: {
  id: string; name: string; email: string; role: string; gender: string; profile_completed: boolean
}): UserDTO {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, gender: u.gender,
    profileCompleted: u.profile_completed,
  }
}

export async function getMe(userId: string): Promise<UserDTO> {
  const user = await findUserById(userId)
  if (!user) throw new NotFoundError('User not found')
  return toDTO(user)
}

export const completeProfileSchema = z.object({
  role:   z.enum(['PASSENGER', 'DRIVER']),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  // Required only when role is 'DRIVER' — an OAuth sign-in that picks
  // "driver" here is completing their profile for the first time, exactly
  // like a driver registering by email/password always has.
  vehicleName:  z.string().trim().min(1).max(60).optional(),
  seatCapacity: z.number().int().min(1).max(POOL_POLICY.maxSeatsPerBooking).optional(),
})

/**
 * Fills in what an OAuth sign-in (Google, LinkedIn) couldn't supply at
 * sign-in time — role, gender, and a driver's vehicle. The trigger already
 * created a bare PASSENGER/OTHER profile row when Supabase Auth created the
 * account; this is the one-time follow-up step the frontend runs right
 * after an OAuth redirect if that profile still looks unfinished.
 */
export async function completeProfile(
  userId: string,
  data: z.infer<typeof completeProfileSchema>,
): Promise<UserDTO> {
  const existing = await findUserById(userId)
  if (!existing) throw new NotFoundError('User not found')

  if (data.role === 'DRIVER' && (!data.vehicleName || !data.seatCapacity)) {
    const details: Record<string, string[]> = {}
    if (!data.vehicleName) details.vehicleName = ['Required for a driver']
    if (!data.seatCapacity) details.seatCapacity = ['Required for a driver']
    throw new ValidationError(details)
  }

  const updated = await completeProfileRow(userId, { role: data.role, gender: data.gender })

  if (data.role === 'DRIVER') {
    await withTransaction(tx => createVehicle(tx, {
      driverId:     userId,
      name:         data.vehicleName!,
      seatCapacity: data.seatCapacity!,
    })).catch((err: unknown) => {
      // vehicles.driver_id is UNIQUE — a driver completing their profile a
      // second time (or one the trigger already gave a vehicle to, from
      // signUp's own metadata) already has one; that's not an error here.
      if ((err as { code?: string }).code !== '23505') throw err
    })
  }

  return toDTO(updated)
}
