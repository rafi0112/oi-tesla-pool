import { Paisa, taka } from './money'

export const FARE_POLICY = {
  baseFarePaisa:       2000,
  perKmPaisa:          1000,
  poolDiscountPercent: 20,
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
 * A single booking's fare against a given number of bookings sharing the pool.
 * Falls back to the fare quoted at booking time when distance is unknown
 * (missing zone_distances row) — the same fallback the passenger's own fare
 * display uses, so the driver and passenger never see different numbers.
 */
export function farePaisaFor(
  distanceKm: number | null,
  quotedFarePaisa: number,
  activeCount: number,
): number {
  return distanceKm === null ? quotedFarePaisa : fareFor(distanceKm, activeCount)
}
