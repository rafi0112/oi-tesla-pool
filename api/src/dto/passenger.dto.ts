import { RideRow, FeedbackRow } from '../repositories/ride.repo'
import { StatusEventRow } from '../repositories/event.repo'
import { UserRow, Gender } from '../repositories/user.repo'
import { ZoneRow } from '../repositories/zone.repo'
import { fareFor } from '../domain/fare'
import { canTransition } from '../domain/stateMachine'

const ACTIVE_IN_POOL = new Set(['MATCHED', 'PICKED_UP'])

export type FeedbackDTO = FeedbackRow

export interface PassengerRideDTO {
  id: string
  status: string
  farePaisa: number
  quotedFarePaisa: number
  /** What this passenger chose to add on top to attract a driver faster — already folded into quotedFarePaisa and farePaisa, broken out here for display. */
  bonusPaisa: number
  finalFarePaisa: number | null
  pickupZone: { id: number; name: string }
  destinationZone: { id: number; name: string }
  seats: number
  poolId: string | null
  /** Populated once matched. Never carries a co-passenger's details. */
  driver: { name: string; vehicle: string } | null
  sharedWith: number
  /**
   * Gender of every other booking that shared this ride's pool — the ride's
   * own history record. Deliberately never a name: one passenger must never
   * learn another's identity, only their gender.
   */
  sharedGenders: Gender[]
  /**
   * The pool's own wait deadline — null once it's no longer accepting new
   * joins. Every current member reads this same value (see
   * pool.service.ts's applyUrgency), so all of them see the same countdown,
   * and any of them pressing "urgent" shortens what everyone else sees too.
   */
  poolWaitUntil: string | null
  /** True while this booking may still press "urgent" — false once the window's closed or this booking has already used its one press. */
  canApplyUrgency: boolean
  /** Set once this passenger has rated the ride — only possible after DROPPED_OFF. */
  feedback: FeedbackDTO | null
  /** True once the ride is DROPPED_OFF and no feedback has been given yet. */
  canGiveFeedback: boolean
  canCancel: boolean
  /** Why the most recent CANCELLED transition happened — e.g. 'request_expired' when nobody answered in time. Null if never cancelled. */
  cancelReason: string | null
  createdAt: string
}

/**
 * The fare a passenger sees right now. Recomputed from live pool membership on
 * every read rather than stored, so joining or cancelling updates it immediately.
 * Once the trip starts, final_fare_paisa is authoritative and nothing moves.
 * quoted_fare_paisa already has this ride's own bonus folded in (see
 * requestRide in ride.service.ts), so only the live-recompute branch needs to
 * add it explicitly — the same split farePaisaFor uses on the driver side.
 */
function effectiveFarePaisa(r: RideRow): number {
  if (r.final_fare_paisa !== null) return r.final_fare_paisa
  if (r.status === 'CANCELLED') return r.quoted_fare_paisa
  if (r.distance_km === null) return r.quoted_fare_paisa

  const activeBookings = r.shared_with + (ACTIVE_IN_POOL.has(r.status) ? 1 : 0)
  return fareFor(r.distance_km, activeBookings) + r.bonus_paisa
}

export interface RideEventDTO {
  fromStatus: string | null
  toStatus: string
  actor: 'passenger' | 'driver' | 'system'
  reason: string | null
  at: string
}

// The actor is reported by role, never by id — a passenger has no use for
// another user's UUID.
export function toRideEventDTO(e: StatusEventRow, passengerId: string): RideEventDTO {
  const actor = e.actor_user_id === null
    ? 'system'
    : e.actor_user_id === passengerId ? 'passenger' : 'driver'

  return {
    fromStatus: e.from_status,
    toStatus:   e.to_status,
    actor,
    reason:     e.reason,
    at:         e.created_at,
  }
}

export interface PassengerProfileDTO {
  id: string
  name: string
  /** Where this passenger last booked from, or explicitly set as their location. */
  currentZone: { id: number; name: string } | null
}

export function toPassengerProfileDTO(u: UserRow, zone: ZoneRow | null): PassengerProfileDTO {
  return {
    id:          u.id,
    name:        u.name,
    currentZone: zone ? { id: zone.id, name: zone.name } : null,
  }
}

export function toPassengerRideDTO(r: RideRow): PassengerRideDTO {
  return {
    id:               r.id,
    status:           r.status,
    farePaisa:        effectiveFarePaisa(r),
    quotedFarePaisa:  r.quoted_fare_paisa,
    bonusPaisa:       r.bonus_paisa,
    finalFarePaisa:   r.final_fare_paisa,
    pickupZone:       { id: r.pickup_zone_id,      name: r.pickup_zone_name      },
    destinationZone:  { id: r.destination_zone_id, name: r.destination_zone_name },
    seats:            r.seats,
    poolId:           r.pool_id,
    driver:           r.driver_name && r.vehicle_name
                        ? { name: r.driver_name, vehicle: r.vehicle_name }
                        : null,
    sharedWith:       r.shared_with,
    sharedGenders:    r.shared_genders,
    poolWaitUntil:    r.pool_wait_until,
    canApplyUrgency:  r.status === 'MATCHED' && r.pool_wait_until !== null && !r.urgency_used,
    feedback:         r.feedback,
    canGiveFeedback:  r.status === 'DROPPED_OFF' && r.feedback === null,
    canCancel:        canTransition('ride', r.status, 'CANCELLED'),
    cancelReason:     r.cancel_reason,
    createdAt:        r.created_at,
  }
}
