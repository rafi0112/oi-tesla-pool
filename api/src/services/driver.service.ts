import { z } from 'zod'
import { updateDriverAvailability, findUserById } from '../repositories/user.repo'
import { findZoneById } from '../repositories/zone.repo'
import { findOpenRequestsInZone } from '../repositories/ride.repo'
import { findActivePoolByDriver } from '../repositories/pool.repo'
import { loadJoinContext, joinRejectionMessage } from './pool.service'
import { canJoin } from '../domain/matching'
import {
  toDriverProfileDTO, DriverProfileDTO,
  toDriverRequestDTO, DriverRequestDTO,
} from '../dto/driver.dto'
import { NotFoundError, ForbiddenRoleError } from '../errors'

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

/**
 * Open requests in the driver's own zone. When the driver already has an active
 * pool, each row carries the canJoin verdict so the UI can grey out the ones
 * that would be refused, with the same wording the join endpoint would return.
 */
export async function getRequestFeed(driverId: string): Promise<DriverRequestDTO[]> {
  const driver = await findUserById(driverId)
  if (!driver) throw new NotFoundError('Driver not found')

  if (driver.current_zone_id === null) {
    throw new ForbiddenRoleError('Go online in a zone to see ride requests')
  }

  const requests = await findOpenRequestsInZone(driver.current_zone_id)
  const pool = await findActivePoolByDriver(driverId)

  // No pool yet, so any request in the zone can be accepted to start one.
  if (!pool) return requests.map(r => toDriverRequestDTO(r, { ok: true }))

  const ctx = await loadJoinContext(pool)

  return requests.map(r => {
    const verdict = canJoin(
      ctx.snapshot,
      {
        seats:             r.seats,
        pickupZoneId:      r.pickup_zone_id,
        destinationZoneId: r.destination_zone_id,
      },
      ctx.zones,
      ctx.distances,
    )
    return toDriverRequestDTO(r, verdict, joinRejectionMessage(verdict.reason))
  })
}
