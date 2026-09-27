import { describe, it, expect } from 'vitest'
import {
  canJoin, bearingDeg, angleDiff, pooledRouteKm,
  POOL_POLICY, PoolSnapshot,
} from '../../src/domain/matching'
import { zones, distances, zoneId } from '../fixtures/seedZones'

const BANANI    = zoneId('Banani')
const GULSHAN   = zoneId('Gulshan 1')
const MOHAKHALI = zoneId('Mohakhali')
const DHANMONDI = zoneId('Dhanmondi')
const UTTARA    = zoneId('Uttara')
const MIRPUR    = zoneId('Mirpur')

const NOW     = new Date('2026-09-27T10:00:00Z')
const CREATED = new Date('2026-09-27T09:58:00Z') // 2 minutes into the window

/** A FORMING pool from Banani carrying Nusrat, who is headed to Mohakhali. */
function poolWithNusrat(over: Partial<PoolSnapshot> = {}): PoolSnapshot {
  return {
    status:         'FORMING',
    seatsAvailable: 2,
    originZoneId:   BANANI,
    waitForPool:    true,
    createdAt:      CREATED,
    members: [{ rideId: 'nusrat-ride', destinationZoneId: MOHAKHALI, seats: 1 }],
    ...over,
  }
}

/** Rafiq: one seat from Banani to Gulshan 1. */
const rafiq = { seats: 1, pickupZoneId: BANANI, destinationZoneId: GULSHAN }

describe('bearing helpers', () => {
  it('reads Mohakhali and Gulshan 1 as the same side of Banani', () => {
    const diff = angleDiff(
      bearingDeg(zones.get(BANANI)!, zones.get(MOHAKHALI)!),
      bearingDeg(zones.get(BANANI)!, zones.get(GULSHAN)!),
    )
    expect(diff).toBeLessThanOrEqual(POOL_POLICY.maxBearingDiffDeg)
    expect(diff).toBeCloseTo(53.8, 1)
  })

  it('reads Uttara and Dhanmondi as opposite sides of Banani', () => {
    const diff = angleDiff(
      bearingDeg(zones.get(BANANI)!, zones.get(UTTARA)!),
      bearingDeg(zones.get(BANANI)!, zones.get(DHANMONDI)!),
    )
    expect(diff).toBeGreaterThan(POOL_POLICY.maxBearingDiffDeg)
    expect(diff).toBeCloseTo(131.3, 1)
  })

  it('treats angleDiff as symmetric and wrap-safe', () => {
    expect(angleDiff(10, 350)).toBe(20)
    expect(angleDiff(350, 10)).toBe(20)
    expect(angleDiff(0, 180)).toBe(180)
  })
})

describe('pooledRouteKm', () => {
  it('visits the nearest destination first', () => {
    // Banani -> Mohakhali (3.0) -> Gulshan 1 (2.0)
    expect(pooledRouteKm(BANANI, [MOHAKHALI, GULSHAN], distances)).toBe(5.0)
  })

  it('does not depend on the order the destinations are given', () => {
    expect(pooledRouteKm(BANANI, [GULSHAN, MOHAKHALI], distances))
      .toBe(pooledRouteKm(BANANI, [MOHAKHALI, GULSHAN], distances))
  })

  it('returns a single leg for one destination', () => {
    expect(pooledRouteKm(BANANI, [MOHAKHALI], distances)).toBe(3.0)
  })
})

describe('canJoin — the story case', () => {
  it('lets Rafiq join Nusrat', () => {
    // route 5.0 km, longest solo leg 4.0 km, cap 7.0 km, bearings 53.8 degrees apart
    expect(canJoin(poolWithNusrat(), rafiq, zones, distances, NOW)).toEqual({ ok: true })
  })
})

describe('canJoin — rejections', () => {
  it('rejects a different pickup zone', () => {
    const fromElsewhere = { ...rafiq, pickupZoneId: GULSHAN }
    expect(canJoin(poolWithNusrat(), fromElsewhere, zones, distances, NOW))
      .toEqual({ ok: false, reason: 'different_pickup_zone' })
  })

  it('rejects a full pool', () => {
    expect(canJoin(poolWithNusrat({ seatsAvailable: 0 }), rafiq, zones, distances, NOW))
      .toEqual({ ok: false, reason: 'pool_full' })
  })

  it('rejects a request for more seats than remain', () => {
    const threeSeats = { ...rafiq, seats: 3 }
    expect(canJoin(poolWithNusrat({ seatsAvailable: 2 }), threeSeats, zones, distances, NOW))
      .toEqual({ ok: false, reason: 'pool_full' })
  })

  it('rejects an EN_ROUTE pool', () => {
    expect(canJoin(poolWithNusrat({ status: 'EN_ROUTE' }), rafiq, zones, distances, NOW))
      .toEqual({ ok: false, reason: 'pool_not_joinable' })
  })

  it('rejects a COMPLETED pool', () => {
    expect(canJoin(poolWithNusrat({ status: 'COMPLETED' }), rafiq, zones, distances, NOW))
      .toEqual({ ok: false, reason: 'pool_not_joinable' })
  })

  it('rejects a destination in the opposite direction', () => {
    // Nusrat heads north to Uttara; the candidate wants to go south to Dhanmondi.
    const pool = poolWithNusrat({
      members: [{ rideId: 'nusrat-ride', destinationZoneId: UTTARA, seats: 1 }],
    })
    const southbound = { ...rafiq, destinationZoneId: DHANMONDI }
    expect(canJoin(pool, southbound, zones, distances, NOW))
      .toEqual({ ok: false, reason: 'opposite_direction' })
  })

  it('rejects when the first passenger chose not to wait', () => {
    expect(canJoin(poolWithNusrat({ waitForPool: false }), rafiq, zones, distances, NOW))
      .toEqual({ ok: false, reason: 'not_waiting_for_pool' })
  })

  it('rejects once the pooling window has closed', () => {
    const stale = new Date(NOW.getTime() - (POOL_POLICY.poolWindowMinutes + 1) * 60_000)
    expect(canJoin(poolWithNusrat({ createdAt: stale }), rafiq, zones, distances, NOW))
      .toEqual({ ok: false, reason: 'pool_window_expired' })
  })

  it('still accepts a request on the last minute of the window', () => {
    const edge = new Date(NOW.getTime() - POOL_POLICY.poolWindowMinutes * 60_000)
    expect(canJoin(poolWithNusrat({ createdAt: edge }), rafiq, zones, distances, NOW))
      .toEqual({ ok: true })
  })

  it('rejects a detour beyond the cap even when the directions agree', () => {
    // Banani -> Mirpur then Uttara: bearings only 36 degrees apart, so the
    // direction check passes, but the route is 19.0 km against a 12.0 km cap.
    const pool = poolWithNusrat({
      members: [{ rideId: 'nusrat-ride', destinationZoneId: MIRPUR, seats: 1 }],
    })
    const toUttara = { seats: 1, pickupZoneId: BANANI, destinationZoneId: UTTARA }

    const bearingSpread = angleDiff(
      bearingDeg(zones.get(BANANI)!, zones.get(MIRPUR)!),
      bearingDeg(zones.get(BANANI)!, zones.get(UTTARA)!),
    )
    expect(bearingSpread).toBeLessThanOrEqual(POOL_POLICY.maxBearingDiffDeg)

    expect(canJoin(pool, toUttara, zones, distances, NOW))
      .toEqual({ ok: false, reason: 'detour_too_long' })
  })
})
