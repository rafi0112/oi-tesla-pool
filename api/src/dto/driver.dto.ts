import { PoolRow, PoolMemberRow } from '../repositories/pool.repo'
import { UserRow } from '../repositories/user.repo'
import { ZoneRow } from '../repositories/zone.repo'
import { OpenRequestRow } from '../repositories/ride.repo'

export interface DriverProfileDTO {
  id: string
  name: string
  isOnline: boolean
  currentZone: { id: number; name: string } | null
}

export function toDriverProfileDTO(u: UserRow, zone: ZoneRow | null): DriverProfileDTO {
  return {
    id:          u.id,
    name:        u.name,
    isOnline:    u.is_online,
    currentZone: zone ? { id: zone.id, name: zone.name } : null,
  }
}

export interface DriverRequestDTO {
  rideId: string
  passengerName: string
  seats: number
  pickupZone: { id: number; name: string }
  destinationZone: { id: number; name: string }
  requestedAt: string
  joinable: boolean
  reason?: string
}

// No fare fields: a driver never sees what a passenger pays.
export function toDriverRequestDTO(
  r: OpenRequestRow,
  verdict: { ok: boolean; reason?: string },
  message?: string,
): DriverRequestDTO {
  return {
    rideId:          r.id,
    passengerName:   r.passenger_name,
    seats:           r.seats,
    pickupZone:      { id: r.pickup_zone_id,      name: r.pickup_zone_name      },
    destinationZone: { id: r.destination_zone_id, name: r.destination_zone_name },
    requestedAt:     r.created_at,
    joinable:        verdict.ok,
    ...(verdict.ok ? {} : { reason: message ?? verdict.reason }),
  }
}

export interface DriverPoolDTO {
  id: string
  status: string
  seatsAvailable: number
  seatCapacity: number
  originZone: { id: number; name: string }
  waitForPool: boolean
  createdAt: string
  passengers: DriverPassengerDTO[]
}

export interface DriverPassengerDTO {
  rideId: string
  name: string
  seats: number
  status: string
  pickupZone: { id: number; name: string }
  destinationZone: { id: number; name: string }
}

// Deliberately omits every fare column — a driver never sees passenger fares.
export function toDriverPoolDTO(pool: PoolRow, members: PoolMemberRow[]): DriverPoolDTO {
  return {
    id:             pool.id,
    status:         pool.status,
    seatsAvailable: pool.seats_available,
    seatCapacity:   pool.seat_capacity,
    originZone:     { id: pool.origin_zone_id, name: pool.origin_zone_name },
    waitForPool:    pool.wait_for_pool,
    createdAt:      pool.created_at,
    passengers:     members.map(toDriverPassengerDTO),
  }
}

export function toDriverPassengerDTO(m: PoolMemberRow): DriverPassengerDTO {
  return {
    rideId:          m.ride_id,
    name:            m.passenger_name,
    seats:           m.seats,
    status:          m.status,
    pickupZone:      { id: m.pickup_zone_id,      name: m.pickup_zone_name      },
    destinationZone: { id: m.destination_zone_id, name: m.destination_zone_name },
  }
}
