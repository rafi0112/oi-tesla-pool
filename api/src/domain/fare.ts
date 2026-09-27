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
