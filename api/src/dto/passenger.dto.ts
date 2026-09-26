import { RideRow } from '../repositories/ride.repo'

const CANCELLABLE = new Set(['REQUESTED', 'MATCHED'])

export interface PassengerRideDTO {
  id: string
  status: string
  quotedFarePaisa: number
  finalFarePaisa: number | null
  pickupZone: { id: number; name: string }
  destinationZone: { id: number; name: string }
  seats: number
  poolId: string | null
  canCancel: boolean
  createdAt: string
}

export function toPassengerRideDTO(r: RideRow): PassengerRideDTO {
  return {
    id:               r.id,
    status:           r.status,
    quotedFarePaisa:  r.quoted_fare_paisa,
    finalFarePaisa:   r.final_fare_paisa,
    pickupZone:       { id: r.pickup_zone_id,      name: r.pickup_zone_name      },
    destinationZone:  { id: r.destination_zone_id, name: r.destination_zone_name },
    seats:            r.seats,
    poolId:           r.pool_id,
    canCancel:        CANCELLABLE.has(r.status),
    createdAt:        r.created_at,
  }
}
