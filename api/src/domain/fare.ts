import { Paisa, taka } from './money'

export const FARE_POLICY = {
  baseFarePaisa:       2000,
  perKmPaisa:          1000,
  poolDiscountPercent: 20,
  // The most a passenger may add on top of their fare to attract a driver
  // faster (see matching.ts's requestExpiryMinutes). A flat sanity cap, not a
  // percentage of the trip — the same reasoning assumption 3 gives for the
  // detour cap: a percentage would make it meaningless on a short hop and
  // extortionate on a long one.
  maxBonusPaisa:       5000,
}

export function soloFare(distanceKm: number): Paisa {
  return taka(FARE_POLICY.baseFarePaisa + Math.round(distanceKm * FARE_POLICY.perKmPaisa))
}

export function pooledFare(distanceKm: number): Paisa {
  const solo = soloFare(distanceKm)
  const discount = Math.round(solo * FARE_POLICY.poolDiscountPercent / 100)
  return taka(solo - discount)
}

/**
 * Fare is charged per booking, never per seat: a passenger who reserves extra
 * seats is bringing a friend or relative and pays one fare for the group.
 * The discount therefore depends on how many separate bookings share the
 * vehicle, not on how many seats are occupied.
 */
export function fareFor(distanceKm: number, activePassengerCount: number): Paisa {
  return activePassengerCount >= 2 ? pooledFare(distanceKm) : soloFare(distanceKm)
}

/**
 * A single booking's fare against a given number of bookings sharing the pool,
 * plus whatever bonus that passenger offered to attract a driver. Falls back
 * to the fare quoted at booking time when distance is unknown (missing
 * zone_distances row) — quotedFarePaisa already has its own bonus baked in
 * (see requestRide in ride.service.ts), so both branches end up meaning the
 * same thing: solo/pooled fare plus bonus. Keeps the driver and passenger
 * seeing the exact same number.
 */
export function farePaisaFor(
  distanceKm: number | null,
  quotedFarePaisa: number,
  bonusPaisa: number,
  activeCount: number,
): number {
  return distanceKm === null ? quotedFarePaisa : fareFor(distanceKm, activeCount) + bonusPaisa
}
