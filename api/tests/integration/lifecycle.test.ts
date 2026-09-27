import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  truncateAll, seedWorld, seatsAvailable, poolStatus,
  poolEventReasons, closeDb, TestWorld,
} from '../helpers/db'
import {
  tokenFor, goOnline, bookRide, openPool, joinPool,
  closePoolReq, arriveReq, startReq, completeReq, dropoffReq,
  getRideReq, activePoolReq, expectStatus,
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

    // Nusrat books alone and is quoted the solo fare.
    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })
    expect(nusratRide.farePaisa).toBe(5000)

    // Jashim accepts and agrees to wait for one more.
    const pool = await openPool(jashim, nusratRide.id, true)
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
    const pool = await openPool(jashim, ride.id, false)
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

describe('waitForPool', () => {
  it('opens the pool closed when the passenger will not wait', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })
    const pool = await openPool(jashim, nusratRide.id, false)
    expect(pool.status).toBe('ACCEPTED')

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
    const pool = await openPool(jashim, ride.id, false)

    const res = await closePoolReq(jashim, pool.id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVALID_TRANSITION')
  })
})

describe('active pool', () => {
  it('is null before the driver accepts anyone', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const res = expectStatus(await activePoolReq(jashim), 200)
    expect(res.body.pool).toBeNull()
  })

  it('lists the passengers without any fare', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })
    await openPool(jashim, ride.id, true)

    const res = expectStatus(await activePoolReq(jashim), 200)
    expect(res.body.pool.passengers).toHaveLength(1)
    expect(res.body.pool.passengers[0].name).toBe('Nusrat Jahan')
    expect(JSON.stringify(res.body.pool)).not.toMatch(/paisa|fare/i)
  })
})

describe('pool auto-cancellation', () => {
  it('cancels the pool when its only passenger backs out', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })
    const pool = await openPool(jashim, ride.id, true)

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
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })
    const pool = await openPool(jashim, nusratRide.id, true)

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
