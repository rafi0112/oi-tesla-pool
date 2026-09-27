import { z } from 'zod'
import { updateDriverAvailability } from '../repositories/user.repo'
import { findZoneById } from '../repositories/zone.repo'
import { toDriverProfileDTO, DriverProfileDTO } from '../dto/driver.dto'
import { NotFoundError } from '../errors'

export const availabilitySchema = z
  .object({
    isOnline: z.boolean(),
    zoneId:   z.number().int().positive().optional(),
  })
  .refine(d => !d.isOnline || d.zoneId !== undefined, {
    message: 'zoneId is required when going online',
    path:    ['zoneId'],
  })

/**
 * Going online pins the driver to a zone; going offline clears it. A null
 * current_zone_id is what makes the request feed refuse to serve them.
 */
export async function setAvailability(
  driverId: string,
  data: z.infer<typeof availabilitySchema>,
): Promise<DriverProfileDTO> {
  if (!data.isOnline) {
    const user = await updateDriverAvailability(driverId, false, null)
    return toDriverProfileDTO(user, null)
  }

  const zone = await findZoneById(data.zoneId!)
  if (!zone) throw new NotFoundError('Zone not found')

  const user = await updateDriverAvailability(driverId, true, zone.id)
  return toDriverProfileDTO(user, zone)
}
