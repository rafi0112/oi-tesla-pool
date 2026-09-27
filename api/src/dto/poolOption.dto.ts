import { PoolRow } from '../repositories/pool.repo'
import { POOL_POLICY } from '../domain/matching'

export interface PoolOptionDTO {
  id: string
  driverName: string
  vehicleName: string
  originZone: { id: number; name: string }
  seatsAvailable: number
  seatCapacity: number
  windowClosesInSeconds: number
  joinable: boolean
  reason?: string
}

// Deliberately omits every fare column and every co-passenger's name or
// destination — a browsing passenger sees only what they need to decide
// between joining this pool and booking their own.
export function toPoolOptionDTO(
  pool: PoolRow,
  verdict: { ok: boolean; reason?: string },
  message: string | undefined,
): PoolOptionDTO {
  const closesAt = new Date(pool.created_at).getTime() + POOL_POLICY.poolWindowMinutes * 60_000
  const windowClosesInSeconds = Math.max(0, Math.round((closesAt - Date.now()) / 1000))

  return {
    id:             pool.id,
    driverName:     pool.driver_name,
    vehicleName:    pool.vehicle_name,
    originZone:     { id: pool.origin_zone_id, name: pool.origin_zone_name },
    seatsAvailable: pool.seats_available,
    seatCapacity:   pool.seat_capacity,
    windowClosesInSeconds,
    joinable:       verdict.ok,
    ...(verdict.ok ? {} : { reason: message }),
  }
}
