import { RideRow } from '../repositories/ride.repo'
import { fareFor } from '../domain/fare'

const CANCELLABLE = new Set(['REQUESTED', 'MATCHED'])
const ACTIVE_IN_POOL = new Set(['MATCHED', 'PICKED_UP'])

export interface PassengerRideDTO {
  id: string
  status: string
  farePaisa: number
  quotedFarePaisa: number
  finalFarePaisa: number | null
  pickupZone: { id: number; name: string }
  destinationZone: { id: number; name: string }
  seats: number
  poolId: string | null
  sharedWith: number
  canCancel: boolean
  createdAt: string
}

/**
 * The fare a passenger sees right now. Recomputed from live pool membership on
 * every read rather than stored, so joining or cancelling updates it immediately.
 * Once the trip starts, final_fare_paisa is authoritative and nothing moves.
 */
function effectiveFarePaisa(r: RideRow): number {
  if (r.final_fare_paisa !== null) return r.final_fare_paisa
  if (r.status === 'CANCELLED') return r.quoted_fare_paisa
  if (r.distance_km === null) return r.quoted_fare_paisa

  const activeBookings = r.shared_with + (ACTIVE_IN_POOL.has(r.status) ? 1 : 0)
  return fareFor(r.distance_km, activeBookings)
}

export function toPassengerRideDTO(r: RideRow): PassengerRideDTO {
  return {
    id:               r.id,
    status:           r.status,
    farePaisa:        effectiveFarePaisa(r),
    quotedFarePaisa:  r.quoted_fare_paisa,
    finalFarePaisa:   r.final_fare_paisa,
    pickupZone:       { id: r.pickup_zone_id,      name: r.pickup_zone_name      },
    destinationZone:  { id: r.destination_zone_id, name: r.destination_zone_name },
    seats:            r.seats,
    poolId:           r.pool_id,
    sharedWith:       r.shared_with,
    canCancel:        CANCELLABLE.has(r.status),
    createdAt:        r.created_at,
  }
}
