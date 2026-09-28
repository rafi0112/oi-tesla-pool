export type Role = 'PASSENGER' | 'DRIVER'

export type Gender = 'MALE' | 'FEMALE' | 'OTHER'

export type RideStatus =
  | 'REQUESTED' | 'MATCHED' | 'PICKED_UP' | 'DROPPED_OFF' | 'CANCELLED'

export type PoolStatus =
  | 'FORMING' | 'ACCEPTED' | 'DRIVER_ARRIVED' | 'EN_ROUTE' | 'COMPLETED' | 'CANCELLED'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  gender: Gender
}

export interface Zone {
  id: number
  name: string
  lat: number
  lng: number
}

export interface ZoneRef {
  id: number
  name: string
}

export interface Quote {
  distanceKm: number
  soloFarePaisa: number
  pooledFarePaisa: number
}

export interface Feedback {
  rating: number
  comment: string | null
  createdAt: string
}

export interface PassengerRide {
  id: string
  status: RideStatus
  farePaisa: number
  quotedFarePaisa: number
  finalFarePaisa: number | null
  pickupZone: ZoneRef
  destinationZone: ZoneRef
  seats: number
  poolId: string | null
  driver: { name: string; vehicle: string } | null
  sharedWith: number
  /** Gender of everyone else who shared this ride's pool — never their name. */
  sharedGenders: Gender[]
  /** Set once this passenger has rated the ride — only possible after DROPPED_OFF. */
  feedback: Feedback | null
  /** True once the ride is DROPPED_OFF and no feedback has been given yet. */
  canGiveFeedback: boolean
  canCancel: boolean
  createdAt: string
}

export interface RideEvent {
  fromStatus: RideStatus | null
  toStatus: RideStatus
  actor: 'passenger' | 'driver' | 'system'
  reason: string | null
  at: string
}

export interface PassengerProfile {
  id: string
  name: string
  /** Where this passenger last booked from, or explicitly set as their location. */
  currentZone: ZoneRef | null
}

export interface DriverProfile {
  id: string
  name: string
  isOnline: boolean
  currentZone: ZoneRef | null
  vehicle: { name: string; seatCapacity: number } | null
  /** Lifetime earnings across every fully dropped-off ride this driver has completed. */
  totalEarningsPaisa: number
}

export interface DriverPassenger {
  rideId: string
  name: string
  seats: number
  status: RideStatus
  pickupZone: ZoneRef
  destinationZone: ZoneRef
  farePaisa: number
}

export interface DriverPool {
  id: string
  status: PoolStatus
  seatsAvailable: number
  seatCapacity: number
  originZone: ZoneRef
  /** Null: no one aboard is waiting for more. A timestamp: the live deadline. */
  waitUntil: string | null
  createdAt: string
  /** Sum of every member's fare — what this pool pays in total, right now. */
  grossFarePaisa: number
  passengers: DriverPassenger[]
}

export interface DriverRequest {
  rideId: string
  passengerName: string
  seats: number
  /** The passenger's own choice — the driver no longer decides this. */
  waitMinutes: number
  pickupZone: ZoneRef
  destinationZone: ZoneRef
  requestedAt: string
  joinable: boolean
  /**
   * What accepting this request would pay, in total, the moment it's accepted:
   * this passenger's own fare alone if the driver has no pool yet, or the
   * whole pool's new total (every current member plus this one, re-priced at
   * the bigger shared-ride discount) if the driver already has an active pool.
   */
  grossFarePaisa: number
  reason?: string
}

/** A pool a browsing passenger could join instead of starting a new one. */
export interface PoolOption {
  id: string
  driverName: string
  vehicleName: string
  originZone: ZoneRef
  seatsAvailable: number
  seatCapacity: number
  windowClosesInSeconds: number
  /** Gender of each passenger already aboard, one entry per current member — never their name. */
  memberGenders: Gender[]
  joinable: boolean
  reason?: string
}

export interface JoinAttempt {
  ok: boolean
  reason?: string
  message?: string
}
