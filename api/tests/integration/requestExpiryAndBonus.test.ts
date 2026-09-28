import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  truncateAll, seedWorld, backdateRideRequest, closeDb, TestWorld,
} from '../helpers/db'
import {
  tokenFor, goOnline, bookRide, openPool, joinPool, api,
  getRideReq, myRidesReq, requestFeedReq, expectStatus,
} from '../helpers/api'

let world: TestWorld
let banani: number
let mohakhali: number
let gulshan: number

beforeEach(async () => {
  await truncateAll()
  world = await seedWorld(['Nusrat Jahan', 'Rafiq Hasan'])
  banani    = world.zoneId('Banani')
  mohakhali = world.zoneId('Mohakhali')
  gulshan   = world.zoneId('Gulshan 1')
})

afterAll(closeDb)

describe('a REQUESTED ride expires after 15 minutes unanswered', () => {
  it('auto-cancels on the next read of it, with the reason recorded', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    await backdateRideRequest(ride.id)

    const view = expectStatus(await getRideReq(nusrat, ride.id), 200)
    expect(view.body.ride.status).toBe('CANCELLED')
    expect(view.body.ride.cancelReason).toBe('request_expired')

    const steps = view.body.timeline.map((e: { toStatus: string; reason: string | null }) => [e.toStatus, e.reason])
    expect(steps).toEqual([['CANCELLED', 'request_expired']])
  })

  it('also self-heals from the ride list, not just a single-ride read', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    await backdateRideRequest(ride.id)

    const list = expectStatus(await myRidesReq(nusrat), 200)
    const mine = list.body.rides.find((r: { id: string }) => r.id === ride.id)
    expect(mine.status).toBe('CANCELLED')
  })

  it('drops out of the driver’s request feed once expired', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })

    const before = expectStatus(await requestFeedReq(jashim), 200)
    expect(before.body.requests.map((r: { rideId: string }) => r.rideId)).toContain(ride.id)

    await backdateRideRequest(ride.id)

    const after = expectStatus(await requestFeedReq(jashim), 200)
    expect(after.body.requests.map((r: { rideId: string }) => r.rideId)).not.toContain(ride.id)
  })

  it('a fresh request under 15 minutes old is left alone', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    const view = expectStatus(await getRideReq(nusrat, ride.id), 200)
    expect(view.body.ride.status).toBe('REQUESTED')
  })

  it('frees the passenger to book again immediately, without ALREADY_ACTIVE', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const first = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    await backdateRideRequest(first.id)

    // No read of the stale ride happened yet — requestRide must self-heal it.
    const second = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 })
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('REQUESTED')

    const firstView = expectStatus(await getRideReq(nusrat, first.id), 200)
    expect(firstView.body.ride.status).toBe('CANCELLED')
  })

  it('never expires a ride that has already been matched', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    await openPool(jashim, ride.id)
    await backdateRideRequest(ride.id)

    const view = expectStatus(await getRideReq(nusrat, ride.id), 200)
    expect(view.body.ride.status).toBe('MATCHED')
  })
})

describe('offering a bonus to attract a driver', () => {
  it('is folded into the passenger’s own quoted and live fare', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, bonusPaisa: 1000,
    })
    expect(ride.farePaisa).toBe(6000) // solo 5000 + 1000 bonus

    const view = expectStatus(await getRideReq(nusrat, ride.id), 200)
    expect(view.body.ride.quotedFarePaisa).toBe(6000)
    expect(view.body.ride.bonusPaisa).toBe(1000)
  })

  it('survives into the pooled discount once someone else joins', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5, bonusPaisa: 1000,
    })
    const pool = await openPool(jashim, nusratRide.id)
    const rafiqRide = await bookRide(rafiq, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 })
    await joinPool(jashim, pool.id, rafiqRide.id)

    const view = expectStatus(await getRideReq(nusrat, nusratRide.id), 200)
    // Pooled rate on 3km is 4000 (20% off 5000), plus Nusrat's own 1000 bonus.
    expect(view.body.ride.farePaisa).toBe(5000)
  })

  it('raises what the driver sees they would earn by accepting', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, bonusPaisa: 1000 })

    const feed = expectStatus(await requestFeedReq(jashim), 200)
    expect(feed.body.requests[0].bonusPaisa).toBe(1000)
    expect(feed.body.requests[0].grossFarePaisa).toBe(6000)
  })

  it('surfaces boosted requests first in the driver’s feed, regardless of age', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const plain = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    const boosted = await bookRide(rafiq, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1, bonusPaisa: 2000 })

    const feed = expectStatus(await requestFeedReq(jashim), 200)
    expect(feed.body.requests[0].rideId).toBe(boosted.id)
    expect(feed.body.requests[1].rideId).toBe(plain.id)
  })

  it('rejects a bonus above the policy cap as 422', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const res = await api()
      .post('/rides')
      .set('Authorization', `Bearer ${nusrat}`)
      .send({ pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, bonusPaisa: 999999 })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
