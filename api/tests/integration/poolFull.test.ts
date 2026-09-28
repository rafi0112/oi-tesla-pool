import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  truncateAll, seedWorld, seatsAvailable, poolStatus, poolWaitUntil,
  poolEventReasons, closeDb, TestWorld,
} from '../helpers/db'
import {
  tokenFor, goOnline, bookRide, openPool, joinPool, bookRideIntoPool,
  expectStatus,
} from '../helpers/api'

let world: TestWorld
let banani: number
let mohakhali: number
let gulshan: number
let dhanmondi: number

beforeEach(async () => {
  await truncateAll()
  world = await seedWorld(['Nusrat Jahan', 'Rafiq Hasan', 'Shirin Akter'])
  banani    = world.zoneId('Banani')
  mohakhali = world.zoneId('Mohakhali')
  gulshan   = world.zoneId('Gulshan 1')
  dhanmondi = world.zoneId('Dhanmondi')
})

afterAll(closeDb)

describe('a pool closes its own wait window the instant it fills up', () => {
  it('when the driver’s own accept takes the last seat', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')
    const shirin = await tokenFor('Shirin Akter')

    const nusratRide = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10 })
    const pool = await openPool(jashim, nusratRide.id)
    expect(pool.status).toBe('FORMING')

    const rafiqRide = await bookRide(rafiq, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    expectStatus(await joinPool(jashim, pool.id, rafiqRide.id), 201)
    expect(await poolStatus(pool.id)).toBe('FORMING') // 1 seat still open
    expect(await seatsAvailable(pool.id)).toBe(1)

    const shirinRide = await bookRide(shirin, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    expectStatus(await joinPool(jashim, pool.id, shirinRide.id), 201)

    // Full now — the window should have closed itself, no driver action taken.
    expect(await seatsAvailable(pool.id)).toBe(0)
    expect(await poolStatus(pool.id)).toBe('ACCEPTED')
    expect(await poolWaitUntil(pool.id)).toBeNull()
    expect(await poolEventReasons(pool.id)).toContain('ACCEPTED:pool_full')
  })

  it('when a passenger’s own self-join takes the last seat', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')
    const shirin = await tokenFor('Shirin Akter')

    const nusratRide = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10 })
    const pool = await openPool(jashim, nusratRide.id)
    const rafiqRide = await bookRide(rafiq, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    expectStatus(await joinPool(jashim, pool.id, rafiqRide.id), 201)

    const result = await bookRideIntoPool(shirin, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, poolId: pool.id,
    })
    expect(result.joinAttempt).toEqual({ ok: true })

    expect(await poolStatus(pool.id)).toBe('ACCEPTED')
    expect(await poolWaitUntil(pool.id)).toBeNull()
  })

  it('refuses a further join once full, same as any other closed pool', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')
    const shirin = await tokenFor('Shirin Akter')

    const nusratRide = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10 })
    const pool = await openPool(jashim, nusratRide.id)
    const rafiqRide = await bookRide(rafiq, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 2 })
    expectStatus(await joinPool(jashim, pool.id, rafiqRide.id), 201)
    expect(await seatsAvailable(pool.id)).toBe(0)

    const shirinRide = await bookRide(shirin, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    const res = await joinPool(jashim, pool.id, shirinRide.id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('POOL_FULL')
  })

  it('starts a pool as ACCEPTED, not FORMING, when the opening booking alone fills the vehicle', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, dhanmondi)
    const nusrat = await tokenFor('Nusrat Jahan')

    // Bullet has 3 seats; one booking for all 3 leaves nobody to wait for.
    const ride = await bookRide(nusrat, {
      pickupZoneId: dhanmondi, destinationZoneId: mohakhali, seats: 3, waitMinutes: 10,
    })
    const pool = await openPool(jashim, ride.id)

    expect(pool.status).toBe('ACCEPTED')
    expect(pool.waitUntil).toBeNull()
    expect(await seatsAvailable(pool.id)).toBe(0)
  })

  it('still opens FORMING when the opening booking leaves room', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, gulshan)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: gulshan, destinationZoneId: mohakhali, seats: 1, waitMinutes: 10,
    })
    const pool = await openPool(jashim, ride.id)

    expect(pool.status).toBe('FORMING')
    expect(pool.waitUntil).not.toBeNull()
  })
})
