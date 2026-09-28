import { PoolRow, PoolMemberRow, VehicleRow } from '../repositories/pool.repo'
import { UserRow } from '../repositories/user.repo'
import { ZoneRow } from '../repositories/zone.repo'
import { OpenRequestRow } from '../repositories/ride.repo'
import { farePaisaFor } from '../domain/fare'

const ACTIVE_MEMBER_STATUSES = new Set(['MATCHED', 'PICKED_UP'])

export interface DriverProfileDTO {
  id: string
  name: string
  isOnline: boolean
  currentZone: { id: number; name: string } | null
  vehicle: { name: string; seatCapacity: number } | null
  /** Lifetime earnings across every fully dropped-off ride this driver has completed. */
  totalEarningsPaisa: number
}

export function toDriverProfileDTO(
  u: UserRow,
  zone: ZoneRow | null,
  vehicle: VehicleRow | null,
  totalEarningsPaisa: number,
): DriverProfileDTO {
  return {
    id:                 u.id,
    name:               u.name,
    isOnline:           u.is_online,
    currentZone:        zone ? { id: zone.id, name: zone.name } : null,
    vehicle:            vehicle ? { name: vehicle.name, seatCapacity: vehicle.seat_capacity } : null,
    totalEarningsPaisa,
  }
}

export interface DriverRequestDTO {
  rideId: string
  passengerName: string
  seats: number
  /** The passenger's own choice — the driver no longer decides this. */
  waitMinutes: number
  pickupZone: { id: number; name: string }
  destinationZone: { id: number; name: string }
  requestedAt: string
  joinable: boolean
  /**
   * What accepting this request would pay, in total, the moment it's accepted:
   * this passenger's own fare alone if the driver has no pool yet (accepting
   * opens a fresh one), or the whole pool's new total — every current member
   * plus this one, all re-priced at the bigger shared-ride discount — if the
   * driver already has an active pool this request could join.
   */
  grossFarePaisa: number
  reason?: string
}

export function toDriverRequestDTO(
  r: OpenRequestRow,
  verdict: { ok: boolean; reason?: string },
  grossFarePaisa: number,
  message?: string,
): DriverRequestDTO {
  return {
    rideId:          r.id,
    passengerName:   r.passenger_name,
    seats:           r.seats,
    waitMinutes:     r.wait_minutes,
    pickupZone:      { id: r.pickup_zone_id,      name: r.pickup_zone_name      },
    destinationZone: { id: r.destination_zone_id, name: r.destination_zone_name },
    requestedAt:     r.created_at,
    joinable:        verdict.ok,
    grossFarePaisa,
    ...(verdict.ok ? {} : { reason: message ?? verdict.reason }),
  }
}

export interface DriverPoolDTO {
  id: string
  status: string
  seatsAvailable: number
  seatCapacity: number
  originZone: { id: number; name: string }
  /** Null: no one aboard is waiting for more. A timestamp: the live deadline. */
  waitUntil: string | null
  createdAt: string
  /** Sum of every member's fare — what this pool pays in total, right now. */
  grossFarePaisa: number
  passengers: DriverPassengerDTO[]
}

export interface DriverPassengerDTO {
  rideId: string
  name: string
  seats: number
  status: string
  pickupZone: { id: number; name: string }
  destinationZone: { id: number; name: string }
  farePaisa: number
}

/**
 * A member's own fare recomputed live: fixed forever once final_fare_paisa is
 * written at boarding (startTrip), otherwise priced against how many bookings
 * are currently sharing the pool — mirrors the passenger's own fare display.
 */
function memberFarePaisa(m: PoolMemberRow, activeCount: number): number {
  if (m.final_fare_paisa !== null) return m.final_fare_paisa
  return farePaisaFor(m.distance_km, m.quoted_fare_paisa, activeCount)
}

export function toDriverPoolDTO(pool: PoolRow, members: PoolMemberRow[]): DriverPoolDTO {
  const activeCount = members.filter(m => ACTIVE_MEMBER_STATUSES.has(m.status)).length
  const grossFarePaisa = members.reduce((sum, m) => sum + memberFarePaisa(m, activeCount), 0)

  return {
    id:             pool.id,
    status:         pool.status,
    seatsAvailable: pool.seats_available,
    seatCapacity:   pool.seat_capacity,
    originZone:     { id: pool.origin_zone_id, name: pool.origin_zone_name },
    waitUntil:      pool.wait_until,
    createdAt:      pool.created_at,
    grossFarePaisa,
    passengers:     members.map(m => toDriverPassengerDTO(m, activeCount)),
  }
}

export function toDriverPassengerDTO(m: PoolMemberRow, activeCount: number): DriverPassengerDTO {
  return {
    rideId:          m.ride_id,
    name:            m.passenger_name,
    seats:           m.seats,
    status:          m.status,
    pickupZone:      { id: m.pickup_zone_id,      name: m.pickup_zone_name      },
    destinationZone: { id: m.destination_zone_id, name: m.destination_zone_name },
    farePaisa:       memberFarePaisa(m, activeCount),
  }
}
