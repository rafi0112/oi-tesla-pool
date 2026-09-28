import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  truncateAll, seedWorld, seatsAvailable, poolStatus,
  poolEventReasons, expirePoolWait, poolWaitUntil, closeDb, TestWorld,
} from '../helpers/db'
import {
  tokenFor, goOnline, bookRide, openPool, joinPool,
  closePoolReq, arriveReq, startReq, completeReq, dropoffReq,
  getRideReq, activePoolReq, requestFeedReq, driverProfileReq, expectStatus,
} from '../helpers/api'

let world: TestWorld
let banani: number
let mohakhali: number
let gulshan: number

beforeEach(async () => {
  await truncateAll()
  world = await seedWorld(['Nusrat Jahan', 'Rafiq Hasan', 'Shirin Akter'])
  banani    = world.zoneId('Banani')
  mohakhali = world.zoneId('Mohakhali')
  gulshan   = world.zoneId('Gulshan 1')
})

afterAll(closeDb)

describe('the full pooled trip', () => {
  it('carries Nusrat and Rafiq from Banani to their own destinations', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)

    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    // Nusrat books alone, willing to wait 5 minutes, and is quoted the solo fare.
    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    expect(nusratRide.farePaisa).toBe(5000)

    // Jashim accepts; her own wait preference is what opens the window.
    const pool = await openPool(jashim, nusratRide.id)
    expect(pool.status).toBe('FORMING')
    expect(pool.seatsAvailable).toBe(2)

    // Rafiq joins.
    const rafiqRide = await bookRide(rafiq, {
      pickupZoneId: banani, destinationZoneId: gulshan, seats: 1,
    })
    expectStatus(await joinPool(jashim, pool.id, rafiqRide.id), 201)
    expect(await seatsAvailable(pool.id)).toBe(1)

    // Both fares drop to the pooled rate, recomputed on read.
    const nusratView = expectStatus(await getRideReq(nusrat, nusratRide.id), 200)
    const rafiqView  = expectStatus(await getRideReq(rafiq, rafiqRide.id), 200)
    expect(nusratView.body.ride.farePaisa).toBe(4000)
    expect(rafiqView.body.ride.farePaisa).toBe(4800)
    expect(nusratView.body.ride.sharedWith).toBe(1)
    expect(nusratView.body.ride.driver).toEqual({ name: 'Jashim Uddin', vehicle: 'Bullet' })

    // Close the window, arrive, depart.
    expectStatus(await closePoolReq(jashim, pool.id), 200)
    expect(await poolStatus(pool.id)).toBe('ACCEPTED')

    expectStatus(await arriveReq(jashim, pool.id), 200)
    expect(await poolStatus(pool.id)).toBe('DRIVER_ARRIVED')

    expectStatus(await startReq(jashim, pool.id), 200)
    expect(await poolStatus(pool.id)).toBe('EN_ROUTE')

    // Fares are now locked, and both passengers are aboard.
    const aboard = expectStatus(await getRideReq(nusrat, nusratRide.id), 200)
    expect(aboard.body.ride.status).toBe('PICKED_UP')
    expect(aboard.body.ride.finalFarePaisa).toBe(4000)
    expect(aboard.body.ride.canCancel).toBe(false)

    // Completing early is refused while anyone is still aboard.
    const tooEarly = await completeReq(jashim, pool.id)
    expect(tooEarly.status).toBe(409)
    expect(tooEarly.body.error.code).toBe('INVALID_TRANSITION')

    expectStatus(await dropoffReq(jashim, pool.id, nusratRide.id), 200)
    expectStatus(await dropoffReq(jashim, pool.id, rafiqRide.id), 200)
    expectStatus(await completeReq(jashim, pool.id), 200)
    expect(await poolStatus(pool.id)).toBe('COMPLETED')

    // The locked fare survives the trip ending.
    const done = expectStatus(await getRideReq(nusrat, nusratRide.id), 200)
    expect(done.body.ride.status).toBe('DROPPED_OFF')
    expect(done.body.ride.farePaisa).toBe(4000)
  })

  it('records every transition on the ride timeline', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })
    const pool = await openPool(jashim, ride.id)
    await arriveReq(jashim, pool.id)
    await startReq(jashim, pool.id)
    await dropoffReq(jashim, pool.id, ride.id)

    const res = expectStatus(await getRideReq(nusrat, ride.id), 200)
    const steps = res.body.timeline.map((e: { toStatus: string }) => e.toStatus)
    expect(steps).toEqual(['MATCHED', 'PICKED_UP', 'DROPPED_OFF'])

    // The driver acted on every one of them, and no raw user id is exposed.
    for (const event of res.body.timeline) {
      expect(event.actor).toBe('driver')
      expect(event).not.toHaveProperty('actorUserId')
    }
  })
})

describe('passenger-chosen wait time', () => {
  it('opens the pool closed when the passenger chose not to wait', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    // waitMinutes defaults to 0 — Nusrat did not ask anyone to wait for her.
    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })
    const pool = await openPool(jashim, nusratRide.id)
    expect(pool.status).toBe('ACCEPTED')
    expect(pool.waitUntil).toBeNull()

    const rafiqRide = await bookRide(rafiq, {
      pickupZoneId: banani, destinationZoneId: gulshan, seats: 1,
    })
    const refused = await joinPool(jashim, pool.id, rafiqRide.id)
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('NOT_JOINABLE')
    expect(refused.body.error.details.reason).toBe('not_waiting_for_pool')
  })

  it('refuses to close a pool that is already closed', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })
    const pool = await openPool(jashim, ride.id)

    const res = await closePoolReq(jashim, pool.id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVALID_TRANSITION')
  })

  it('ratchets the deadline earlier when a shorter-patience passenger joins', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)
    const openedUntil = new Date(pool.waitUntil!).getTime()

    const rafiqRide = await bookRide(rafiq, {
      pickupZoneId: banani, destinationZoneId: gulshan, seats: 1, waitMinutes: 3,
    })
    expectStatus(await joinPool(jashim, pool.id, rafiqRide.id), 201)

    const after = expectStatus(await activePoolReq(jashim), 200)
    const closesUntil = new Date(after.body.pool.waitUntil).getTime()

    // Rafiq's shorter 3-minute patience pulled the deadline earlier than
    // Nusrat's original 5-minute one — never later.
    expect(closesUntil).toBeLessThan(openedUntil)
  })

  it('closing the pool blocks joins immediately, even with time left on the clock', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10,
    })
    const pool = await openPool(jashim, nusratRide.id)
    expectStatus(await closePoolReq(jashim, pool.id), 200)

    const rafiqRide = await bookRide(rafiq, {
      pickupZoneId: banani, destinationZoneId: gulshan, seats: 1,
    })
    const refused = await joinPool(jashim, pool.id, rafiqRide.id)
    expect(refused.status).toBe(409)
    expect(refused.body.error.details.reason).toBe('not_waiting_for_pool')
  })

  it('auto-closes on its own once the deadline passes, with no one clicking anything', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, ride.id)
    expect(pool.status).toBe('FORMING')

    await expirePoolWait(pool.id)

    // Nobody has touched the pool since it expired — the very next read is
    // what flips it, not a background job.
    const res = expectStatus(await activePoolReq(jashim), 200)
    expect(res.body.pool.status).toBe('ACCEPTED')
    expect(res.body.pool.waitUntil).toBeNull()
    expect(await poolEventReasons(pool.id)).toEqual([
      'FORMING:pool_created',
      'ACCEPTED:wait_time_elapsed',
    ])
  })

  it('lets the driver arrive on an expired pool instead of failing with a stale FORMING status', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, ride.id)
    await expirePoolWait(pool.id)

    // No one ever called GET /pools/active or POST /pools/:id/close first —
    // "arrive" itself must be the thing that notices the window closed.
    const res = expectStatus(await arriveReq(jashim, pool.id), 200)
    expect(res.body.pool.status).toBe('DRIVER_ARRIVED')
  })

  it('refuses a join against an expired pool and reports the pool as closed afterward', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)
    await expirePoolWait(pool.id)

    const rafiqRide = await bookRide(rafiq, {
      pickupZoneId: banani, destinationZoneId: gulshan, seats: 1,
    })
    const refused = await joinPool(jashim, pool.id, rafiqRide.id)
    expect(refused.status).toBe(409)
    expect(refused.body.error.details.reason).toBe('not_waiting_for_pool')
    expect(await poolStatus(pool.id)).toBe('ACCEPTED')
  })

  it('never reopens a deadline once cleared, even if wait_until is somehow in the future again', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, ride.id)
    await expirePoolWait(pool.id)
    await activePoolReq(jashim) // triggers the auto-close
    expect(await poolWaitUntil(pool.id)).toBeNull()
  })
})

describe('the driver can see what a request or pool pays', () => {
  it('shows the solo fare on a request feed row when the driver has no pool yet', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })

    const feed = expectStatus(await requestFeedReq(jashim), 200)
    expect(feed.body.requests).toHaveLength(1)
    expect(feed.body.requests[0].grossFarePaisa).toBe(5000) // solo fare, Banani→Mohakhali
  })

  it('re-prices the whole pool at the shared rate once a second request could join', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)
    expect(pool.grossFarePaisa).toBe(5000) // just Nusrat, still solo-priced

    await bookRide(rafiq, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 })

    const feed = expectStatus(await requestFeedReq(jashim), 200)
    expect(feed.body.requests).toHaveLength(1)
    // Nusrat re-priced to 4000 plus Rafiq's own pooled fare of 4800.
    expect(feed.body.requests[0].grossFarePaisa).toBe(4000 + 4800)
  })

  it('accumulates completed fares into the driver\'s lifetime total', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const before = expectStatus(await driverProfileReq(jashim), 200)
    expect(before.body.driver.totalEarningsPaisa).toBe(0)

    const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    const pool = await openPool(jashim, ride.id)
    await arriveReq(jashim, pool.id)
    await startReq(jashim, pool.id)
    await dropoffReq(jashim, pool.id, ride.id)
    await completeReq(jashim, pool.id)

    const after = expectStatus(await driverProfileReq(jashim), 200)
    expect(after.body.driver.totalEarningsPaisa).toBe(5000)
  })
})

describe('active pool', () => {
  it('is null before the driver accepts anyone', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const res = expectStatus(await activePoolReq(jashim), 200)
    expect(res.body.pool).toBeNull()
  })

  it('lists the passengers along with the pool\'s gross fare', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    await openPool(jashim, ride.id)

    const res = expectStatus(await activePoolReq(jashim), 200)
    expect(res.body.pool.passengers).toHaveLength(1)
    expect(res.body.pool.passengers[0].name).toBe('Nusrat Jahan')
    expect(res.body.pool.passengers[0].farePaisa).toBeGreaterThan(0)
    expect(res.body.pool.grossFarePaisa).toBe(res.body.pool.passengers[0].farePaisa)
  })
})

describe('pool auto-cancellation', () => {
  it('cancels the pool when its only passenger backs out', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, ride.id)

    const { cancelRideReq } = await import('../helpers/api')
    expectStatus(await cancelRideReq(nusrat, ride.id), 200)

    expect(await poolStatus(pool.id)).toBe('CANCELLED')
    expect(await poolEventReasons(pool.id)).toEqual([
      'FORMING:pool_created',
      'CANCELLED:sole_passenger_cancelled',
    ])
  })

  it('keeps the pool alive while someone is still aboard, then cancels on the last exit', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)

    const rafiqRide = await bookRide(rafiq, {
      pickupZoneId: banani, destinationZoneId: gulshan, seats: 1,
    })
    expectStatus(await joinPool(jashim, pool.id, rafiqRide.id), 201)

    const { cancelRideReq } = await import('../helpers/api')

    // Nusrat leaves; Rafiq is still aboard so the trip goes on.
    expectStatus(await cancelRideReq(nusrat, nusratRide.id), 200)
    expect(await poolStatus(pool.id)).toBe('FORMING')

    // Rafiq reverts to the solo fare now that he is alone.
    const alone = expectStatus(await getRideReq(rafiq, rafiqRide.id), 200)
    expect(alone.body.ride.farePaisa).toBe(6000)
    expect(alone.body.ride.sharedWith).toBe(0)

    // Rafiq leaves too, emptying the pool.
    expectStatus(await cancelRideReq(rafiq, rafiqRide.id), 200)
    expect(await poolStatus(pool.id)).toBe('CANCELLED')
    expect(await poolEventReasons(pool.id)).toContain('CANCELLED:all_passengers_cancelled')
  })
})
