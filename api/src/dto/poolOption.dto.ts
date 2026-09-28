import { PoolRow } from '../repositories/pool.repo'
import { Gender } from '../repositories/user.repo'

export interface PoolOptionDTO {
  id: string
  driverName: string
  vehicleName: string
  originZone: { id: number; name: string }
  seatsAvailable: number
  seatCapacity: number
  windowClosesInSeconds: number
  /** Gender of each passenger already aboard, one entry per current member — never their name. */
  memberGenders: Gender[]
  joinable: boolean
  reason?: string
}

// Deliberately omits every fare column and every co-passenger's name or
// destination — a browsing passenger sees only what they need to decide
// between joining this pool and booking their own. Gender is the one
// exception: it's exposed on purpose, so someone deciding whether to join can
// see who's already aboard before they commit.
export function toPoolOptionDTO(
  pool: PoolRow,
  memberGenders: Gender[],
  verdict: { ok: boolean; reason?: string },
  message: string | undefined,
): PoolOptionDTO {
  // A pool this function sees is FORMING (only findFormingPoolsByOriginZone
  // feeds it), so wait_until is always set — but a defensive fallback to 0
  // costs nothing and keeps the type honest.
  const windowClosesInSeconds = pool.wait_until === null
    ? 0
    : Math.max(0, Math.round((new Date(pool.wait_until).getTime() - Date.now()) / 1000))

  return {
    id:             pool.id,
    driverName:     pool.driver_name,
    vehicleName:    pool.vehicle_name,
    originZone:     { id: pool.origin_zone_id, name: pool.origin_zone_name },
    seatsAvailable: pool.seats_available,
    seatCapacity:   pool.seat_capacity,
    windowClosesInSeconds,
    memberGenders,
    joinable:       verdict.ok,
    ...(verdict.ok ? {} : { reason: message }),
  }
}
