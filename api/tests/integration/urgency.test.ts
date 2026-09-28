import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { truncateAll, seedWorld, poolWaitUntil, closeDb, TestWorld } from '../helpers/db'
import {
  tokenFor, goOnline, bookRide, openPool, joinPool,
  closePoolReq, urgentReq, getRideReq, activePoolReq, expectStatus,
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

describe('POST /pools/:id/urgent', () => {
  it('halves whatever time is left on the pool window', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10,
    })
    const pool = await openPool(jashim, ride.id)

    const before = new Date(await poolWaitUntil(pool.id) as string).getTime()
    const now = Date.now()

    const res = expectStatus(await urgentReq(nusrat, pool.id), 200)
    const after = new Date(res.body.poolWaitUntil).getTime()

    // Halves what's left from *now*, not from the original 10-minute window.
    const expectedRemaining = (before - now) / 2
    const actualRemaining = after - now
    expect(Math.abs(actualRemaining - expectedRemaining)).toBeLessThan(2000)
    expect(after).toBeLessThan(before)
  })

  it('is visible to every other member and to the driver, not just whoever pressed it', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10,
    })
    const pool = await openPool(jashim, nusratRide.id)
    const rafiqRide = await bookRide(rafiq, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 })
    expectStatus(await joinPool(jashim, pool.id, rafiqRide.id), 201)

    // Rafiq — the second passenger, not the one whose wait_minutes opened it — presses urgent.
    const res = expectStatus(await urgentReq(rafiq, pool.id), 200)
    const halved = res.body.poolWaitUntil

    const nusratView = expectStatus(await getRideReq(nusrat, nusratRide.id), 200)
    const rafiqView  = expectStatus(await getRideReq(rafiq, rafiqRide.id), 200)
    const driverView = expectStatus(await activePoolReq(jashim), 200)

    expect(nusratView.body.ride.poolWaitUntil).toBe(halved)
    expect(rafiqView.body.ride.poolWaitUntil).toBe(halved)
    expect(driverView.body.pool.waitUntil).toBe(halved)
  })

  it('refuses a passenger who isn’t in this pool', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10,
    })
    const pool = await openPool(jashim, ride.id)

    const rafiq = await tokenFor('Rafiq Hasan')
    const res = await urgentReq(rafiq, pool.id)
    expect(res.status).toBe(404)
  })

  it('refuses once the pool is no longer waiting', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10,
    })
    const pool = await openPool(jashim, ride.id)

    expectStatus(await closePoolReq(jashim, pool.id), 200)

    const res = await urgentReq(nusrat, pool.id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NOT_WAITING')
  })

  it('refuses a request that never opened a wait window (wait_minutes: 0)', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 0,
    })
    const pool = await openPool(jashim, ride.id)
    expect(pool.status).toBe('ACCEPTED')

    const res = await urgentReq(nusrat, pool.id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NOT_WAITING')
  })

  it('is passenger-only — a driver cannot call it', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10,
    })
    const pool = await openPool(jashim, ride.id)

    const res = await urgentReq(jashim, pool.id)
    expect(res.status).toBe(403)
  })
})
