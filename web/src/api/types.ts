export type Role = 'PASSENGER' | 'DRIVER'

export type RideStatus =
  | 'REQUESTED' | 'MATCHED' | 'PICKED_UP' | 'DROPPED_OFF' | 'CANCELLED'

export type PoolStatus =
  | 'FORMING' | 'ACCEPTED' | 'DRIVER_ARRIVED' | 'EN_ROUTE' | 'COMPLETED' | 'CANCELLED'

export interface User {
  id: string
  name: string
  email: string
  role: Role
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
}

export interface DriverPassenger {
  rideId: string
  name: string
  seats: number
  status: RideStatus
  pickupZone: ZoneRef
  destinationZone: ZoneRef
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
  joinable: boolean
  reason?: string
}

export interface JoinAttempt {
  ok: boolean
  reason?: string
  message?: string
}
