import { z } from 'zod'
import { findUserById, updateUserZone } from '../repositories/user.repo'
import { findZoneById } from '../repositories/zone.repo'
import { toPassengerProfileDTO, PassengerProfileDTO } from '../dto/passenger.dto'
import { NotFoundError } from '../errors'

export const setLocationSchema = z.object({
  zoneId: z.number().int().positive(),
})

export async function getPassengerProfile(passengerId: string): Promise<PassengerProfileDTO> {
  const user = await findUserById(passengerId)
  if (!user) throw new NotFoundError('Passenger not found')

  const zone = user.current_zone_id === null ? null : await findZoneById(user.current_zone_id)
  return toPassengerProfileDTO(user, zone)
}

/**
 * Sets a passenger's current location explicitly — the same "where am I" a
 * driver sets via PATCH /drivers/me, just without the online/offline gate
 * that only makes sense for a driver. Booking a ride does this same update
 * automatically (see ride.service.ts), so this endpoint exists for a
 * passenger who wants to update it without also requesting a ride.
 */
export async function setPassengerLocation(
  passengerId: string,
  data: z.infer<typeof setLocationSchema>,
): Promise<PassengerProfileDTO> {
  const zone = await findZoneById(data.zoneId)
  if (!zone) throw new NotFoundError('Zone not found')

  const user = await updateUserZone(passengerId, zone.id)
  return toPassengerProfileDTO(user, zone)
}
