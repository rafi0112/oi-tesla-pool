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

export function fareFor(distanceKm: number, activePassengerCount: number): Paisa {
  return activePassengerCount >= 2 ? pooledFare(distanceKm) : soloFare(distanceKm)
}
