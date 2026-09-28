import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { truncateAll, seedWorld, seatsAvailable, expirePoolWait, closeDb, TestWorld } from '../helpers/db'
import {
  tokenFor, goOnline, bookRide, bookRideIntoPool, openPool,
  nearbyPoolsReq, getRideReq, expectStatus,
} from '../helpers/api'

let world: TestWorld
let banani: number
let mohakhali: number
let gulshan: number
let uttara: number

beforeEach(async () => {
  await truncateAll()
  world = await seedWorld(['Nusrat Jahan', 'Rafiq Hasan', 'Shirin Akter'])
  banani    = world.zoneId('Banani')
  mohakhali = world.zoneId('Mohakhali')
  gulshan   = world.zoneId('Gulshan 1')
  uttara    = world.zoneId('Uttara')
})

afterAll(closeDb)

describe('GET /pools/nearby', () => {
  it('is empty when nobody is pooling yet', async () => {
    const rafiq = await tokenFor('Rafiq Hasan')
    const res = expectStatus(
      await nearbyPoolsReq(rafiq, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 }),
      200,
    )
    expect(res.body.pools).toEqual([])
  })

  it('lists a compatible pool as joinable, with the driver and seats but no fare', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)

    const rafiq = await tokenFor('Rafiq Hasan')
    const res = expectStatus(
      await nearbyPoolsReq(rafiq, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 }),
      200,
    )

    expect(res.body.pools).toHaveLength(1)
    const option = res.body.pools[0]
    expect(option.id).toBe(pool.id)
    expect(option.driverName).toBe('Jashim Uddin')
    expect(option.vehicleName).toBe('Bullet')
    expect(option.seatsAvailable).toBe(2)
    expect(option.joinable).toBe(true)
    expect(option.reason).toBeUndefined()
    expect(option.windowClosesInSeconds).toBeGreaterThan(0)
    // Nusrat is aboard and FEMALE — her gender is visible, her name is not.
    expect(option.memberGenders).toEqual(['FEMALE'])
    expect(JSON.stringify(option)).not.toMatch(/paisa|fare|Nusrat/i)
  })

  it('lists an incompatible pool too, marked unjoinable with the real reason', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: uttara, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)

    // Shirin wants to go the opposite way from Nusrat.
    const shirin = await tokenFor('Shirin Akter')
    const res = expectStatus(
      await nearbyPoolsReq(shirin, { pickupZoneId: banani, destinationZoneId: world.zoneId('Dhanmondi'), seats: 1 }),
      200,
    )

    expect(res.body.pools).toHaveLength(1)
    expect(res.body.pools[0].id).toBe(pool.id)
    expect(res.body.pools[0].joinable).toBe(false)
    expect(res.body.pools[0].reason).toMatch(/opposite direction/i)
  })

  it('is driver-only from the other side: a driver cannot call it', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    const res = await nearbyPoolsReq(jashim, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 })
    expect(res.status).toBe(403)
  })

  it('rejects a non-numeric query param as 422', async () => {
    const rafiq = await tokenFor('Rafiq Hasan')
    const res = await nearbyPoolsReq(rafiq, { pickupZoneId: NaN as unknown as number, destinationZoneId: gulshan, seats: 1 })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('drops a pool from the listing once its wait time has auto-closed it', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)
    await expirePoolWait(pool.id)

    const rafiq = await tokenFor('Rafiq Hasan')
    const res = expectStatus(
      await nearbyPoolsReq(rafiq, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 }),
      200,
    )
    expect(res.body.pools).toEqual([])
  })
})

describe('POST /rides with poolId — self-service join', () => {
  it('matches the ride straight into the pool when the route fits', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)

    const rafiq = await tokenFor('Rafiq Hasan')
    const result = await bookRideIntoPool(rafiq, {
      pickupZoneId: banani, destinationZoneId: gulshan, seats: 1, poolId: pool.id,
    })

    expect(result.joinAttempt).toEqual({ ok: true })
    expect(result.ride.status).toBe('MATCHED')
    expect(result.ride.poolId).toBe(pool.id)
    expect(await seatsAvailable(pool.id)).toBe(1)

    // The fare recomputes to the pooled rate immediately, same as a driver-side join.
    const view = expectStatus(await getRideReq(rafiq, result.ride.id), 200)
    expect(view.body.ride.farePaisa).toBe(4800)
  })

  it('still creates the ride when the chosen pool refuses it, and says why', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: uttara, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)

    const shirin = await tokenFor('Shirin Akter')
    const result = await bookRideIntoPool(shirin, {
      pickupZoneId: banani, destinationZoneId: world.zoneId('Dhanmondi'), seats: 1, poolId: pool.id,
    })

    expect(result.joinAttempt?.ok).toBe(false)
    expect(result.joinAttempt?.reason).toBe('opposite_direction')
    // The booking itself still went through — the passenger is not blocked.
    expect(result.ride.status).toBe('REQUESTED')
    expect(result.ride.poolId).toBeNull()
    expect(await seatsAvailable(pool.id)).toBe(2)
  })

  it('creates the ride when the poolId no longer exists, without erroring', async () => {
    const rafiq = await tokenFor('Rafiq Hasan')
    const result = await bookRideIntoPool(rafiq, {
      pickupZoneId: banani, destinationZoneId: gulshan, seats: 1,
      poolId: '00000000-0000-0000-0000-000000000000',
    })
    expect(result.joinAttempt).toEqual({ ok: false, reason: 'pool_not_found', message: 'That pool is no longer available' })
    expect(result.ride.status).toBe('REQUESTED')
  })
})
