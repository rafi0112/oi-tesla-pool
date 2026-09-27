import { describe, it, expect } from 'vitest'
import { soloFare, pooledFare, fareFor, FARE_POLICY } from '../../src/domain/fare'
import { formatTaka } from '../../src/domain/money'

// Banani -> Mohakhali is 3.0 km, Banani -> Gulshan 1 is 4.0 km in the seeded matrix.
const NUSRAT_KM = 3.0
const RAFIQ_KM  = 4.0

describe('fare policy', () => {
  it('uses the rates from the brief', () => {
    expect(FARE_POLICY.baseFarePaisa).toBe(2000)
    expect(FARE_POLICY.perKmPaisa).toBe(1000)
    expect(FARE_POLICY.poolDiscountPercent).toBe(20)
  })
})

describe('solo fares', () => {
  it("is exactly 5000 paisa for Nusrat's 3.0 km trip", () => {
    expect(soloFare(NUSRAT_KM)).toBe(5000)
  })

  it("is exactly 6000 paisa for Rafiq's 4.0 km trip", () => {
    expect(soloFare(RAFIQ_KM)).toBe(6000)
  })
})

describe('pooled fares', () => {
  it("is exactly 4000 paisa for Nusrat's 3.0 km trip", () => {
    expect(pooledFare(NUSRAT_KM)).toBe(4000)
  })

  it("is exactly 4800 paisa for Rafiq's 4.0 km trip", () => {
    expect(pooledFare(RAFIQ_KM)).toBe(4800)
  })
})

describe('fareFor', () => {
  it('charges the solo rate to a lone passenger', () => {
    expect(fareFor(NUSRAT_KM, 1)).toBe(5000)
  })

  it('charges the solo rate when no pool exists yet', () => {
    expect(fareFor(NUSRAT_KM, 0)).toBe(5000)
  })

  it('applies the discount once a second booking shares the vehicle', () => {
    expect(fareFor(NUSRAT_KM, 2)).toBe(4000)
    expect(fareFor(RAFIQ_KM, 2)).toBe(4800)
  })

  it('keeps the discount with three bookings aboard', () => {
    expect(fareFor(NUSRAT_KM, 3)).toBe(4000)
  })
})

describe('formatTaka', () => {
  it('renders paisa as taka with two decimals', () => {
    expect(formatTaka(pooledFare(NUSRAT_KM))).toBe('৳40.00')
    expect(formatTaka(soloFare(NUSRAT_KM))).toBe('৳50.00')
    expect(formatTaka(pooledFare(RAFIQ_KM))).toBe('৳48.00')
  })
})

describe('integer paisa', () => {
  it('never produces a fractional value', () => {
    for (const km of [0.5, 1.1, 2.7, 3.33, 7.9, 12.25]) {
      expect(Number.isInteger(soloFare(km))).toBe(true)
      expect(Number.isInteger(pooledFare(km))).toBe(true)
    }
  })
})
