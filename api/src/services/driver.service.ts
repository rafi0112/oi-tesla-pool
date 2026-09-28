import { z } from 'zod'
import { updateDriverAvailability, findUserById } from '../repositories/user.repo'
import { findZoneById } from '../repositories/zone.repo'
import { findOpenRequestsInZone, sumDriverEarnings } from '../repositories/ride.repo'
import { expireIfStale } from './ride.service'
import {
  findActivePoolByDriver, findPoolHistoryByDriver, findVehicleByDriver,
  findPoolMembers, PoolMemberRow,
} from '../repositories/pool.repo'
import { loadJoinContext, joinRejectionMessage } from './pool.service'
import { canJoin } from '../domain/matching'
import { farePaisaFor } from '../domain/fare'
import {
  toDriverProfileDTO, DriverProfileDTO,
  toDriverRequestDTO, DriverRequestDTO,
  toDriverPoolDTO, DriverPoolDTO,
} from '../dto/driver.dto'
import { NotFoundError, ForbiddenRoleError } from '../errors'

const ACTIVE_MEMBER_STATUSES = new Set(['MATCHED', 'PICKED_UP'])

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
  const [vehicle, totalEarningsPaisa] = await Promise.all([
    findVehicleByDriver(driverId),
    sumDriverEarnings(driverId),
  ])

  if (!data.isOnline) {
    const user = await updateDriverAvailability(driverId, false, null)
    return toDriverProfileDTO(user, null, vehicle, totalEarningsPaisa)
  }

  const zone = await findZoneById(data.zoneId!)
  if (!zone) throw new NotFoundError('Zone not found')

  const user = await updateDriverAvailability(driverId, true, zone.id)
  return toDriverProfileDTO(user, zone, vehicle, totalEarningsPaisa)
}

export async function getProfile(driverId: string): Promise<DriverProfileDTO> {
  const user = await findUserById(driverId)
  if (!user) throw new NotFoundError('Driver not found')

  const [zone, vehicle, totalEarningsPaisa] = await Promise.all([
    user.current_zone_id === null ? null : findZoneById(user.current_zone_id),
    findVehicleByDriver(driverId),
    sumDriverEarnings(driverId),
  ])
  return toDriverProfileDTO(user, zone, vehicle, totalEarningsPaisa)
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

  // Stale requests (unanswered 15+ minutes) drop out of the feed the same
  // self-healing way they drop out of the passenger's own view — see
  // expireIfStale in ride.service.ts. Re-query only if something actually
  // expired, so the common case costs nothing extra.
  let requests = await findOpenRequestsInZone(driver.current_zone_id)
  const expired = await Promise.all(requests.map(r => expireIfStale(r.id, r.created_at)))
  if (expired.some(Boolean)) {
    requests = await findOpenRequestsInZone(driver.current_zone_id)
  }

  const pool = await findActivePoolByDriver(driverId)

  // No pool yet: accepting any one of these opens a brand-new solo pool, so
  // each request's gross is just its own fare, priced alone, plus its bonus.
  if (!pool) {
    return requests.map(r =>
      toDriverRequestDTO(r, { ok: true }, farePaisaFor(r.distance_km, r.quoted_fare_paisa, r.bonus_paisa, 1)),
    )
  }

  const ctx = await loadJoinContext(pool)
  const currentMembers: PoolMemberRow[] = await findPoolMembers(pool.id)
  const activeMembers = currentMembers.filter(m => ACTIVE_MEMBER_STATUSES.has(m.status))

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

    // What the pool's total becomes if this request joins: every current
    // member re-priced at the new, bigger shared count (plus each member's own
    // bonus), plus this one's own fare and bonus at that same count.
    const newCount = activeMembers.length + 1
    const grossFarePaisa =
      activeMembers.reduce((sum, m) => sum + farePaisaFor(m.distance_km, m.quoted_fare_paisa, m.bonus_paisa, newCount), 0) +
      farePaisaFor(r.distance_km, r.quoted_fare_paisa, r.bonus_paisa, newCount)

    return toDriverRequestDTO(r, verdict, grossFarePaisa, joinRejectionMessage(verdict.reason))
  })
}

/**
 * This driver's own finished trips — completed or cancelled, newest first.
 * findPoolHistoryByDriver scopes the query to driverId from the caller's own
 * token, so with any number of drivers each one only ever sees their own.
 */
export async function getHistory(driverId: string): Promise<DriverPoolDTO[]> {
  const pools = await findPoolHistoryByDriver(driverId)
  return Promise.all(pools.map(async pool => {
    const members = await findPoolMembers(pool.id)
    return toDriverPoolDTO(pool, members)
  }))
}
