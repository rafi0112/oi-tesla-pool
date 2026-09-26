import { PoolRow, PoolMemberRow } from '../repositories/pool.repo'

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
