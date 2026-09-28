import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { truncateAll, seedWorld, seatsAvailable, closeDb, TestWorld } from '../helpers/db'
import {
  api, tokenFor, goOnline, bookRide, openPool, joinPool,
  arriveReq, startReq, cancelRideReq, getRideReq,
  requestFeedReq, activePoolReq, myRidesReq, expectStatus,
} from '../helpers/api'

let world: TestWorld
let banani: number
let mohakhali: number
let gulshan: number
let dhanmondi: number

beforeEach(async () => {
  await truncateAll()
  world = await seedWorld(['Nusrat Jahan', 'Rafiq Hasan', 'Shirin Akter', 'Tania Rahman'])
  banani    = world.zoneId('Banani')
  mohakhali = world.zoneId('Mohakhali')
  gulshan   = world.zoneId('Gulshan 1')
  dhanmondi = world.zoneId('Dhanmondi')
})

afterAll(closeDb)

describe("Bullet's three seats", () => {
  it('refuses a fourth passenger', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)

    const ride = async (name: string, waitMinutes = 0) => {
      const token = await tokenFor(name)
      return bookRide(token, {
        pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes,
      })
    }

    const first = await ride('Nusrat Jahan', 5)
    const pool = await openPool(jashim, first.id)
    expect(pool.seatsAvailable).toBe(2)

    expectStatus(await joinPool(jashim, pool.id, (await ride('Rafiq Hasan')).id), 201)
    expectStatus(await joinPool(jashim, pool.id, (await ride('Shirin Akter')).id), 201)
    expect(await seatsAvailable(pool.id)).toBe(0)

    const fourth = await joinPool(jashim, pool.id, (await ride('Tania Rahman')).id)
    expect(fourth.status).toBe(409)
    expect(fourth.body.error.code).toBe('POOL_FULL')
    expect(await seatsAvailable(pool.id)).toBe(0)
  })

  it('refuses a booking that wants more seats than remain', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)

    const nusrat = await tokenFor('Nusrat Jahan')
    const first = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 2, waitMinutes: 5,
    })
    const pool = await openPool(jashim, first.id)
    expect(pool.seatsAvailable).toBe(1)

    const rafiq = await tokenFor('Rafiq Hasan')
    const twoSeats = await bookRide(rafiq, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 2,
    })

    const res = await joinPool(jashim, pool.id, twoSeats.id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('POOL_FULL')
    expect(res.body.error.details.reason).toBe('pool_full')
  })

  it('charges one fare for a multi-seat booking', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)

    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 3,
    })
    // Three seats, one booking, still the single solo fare.
    expect(ride.farePaisa).toBe(5000)

    await openPool(jashim, ride.id)
    const res = expectStatus(await getRideReq(nusrat, ride.id), 200)
    expect(res.body.ride.seats).toBe(3)
    expect(res.body.ride.farePaisa).toBe(5000)
    expect(res.body.ride.sharedWith).toBe(0)
  })
})

describe('ownership', () => {
  it("returns 404 when Shirin tries to cancel Nusrat's ride", async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const shirin = await tokenFor('Shirin Akter')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })

    const res = await cancelRideReq(shirin, ride.id)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')

    // Nusrat's ride is untouched.
    const mine = expectStatus(await getRideReq(nusrat, ride.id), 200)
    expect(mine.body.ride.status).toBe('REQUESTED')
  })

  it("returns 404 when Shirin tries to read Nusrat's ride", async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const shirin = await tokenFor('Shirin Akter')
    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })

    const res = await getRideReq(shirin, ride.id)
    expect(res.status).toBe(404)
  })

  it("returns 404 when another driver's pool is targeted", async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, ride.id)

    // A second driver, who owns nothing.
    await api().post('/auth/register').send({
      name: 'Kamal Mia', email: 'kamal@oitesla.test',
      password: 'Password123!', role: 'DRIVER', gender: 'MALE',
    })
    const kamal = (await api().post('/auth/login').send({
      email: 'kamal@oitesla.test', password: 'Password123!',
    })).body.token

    expect((await arriveReq(kamal, pool.id)).status).toBe(404)
  })
})

describe('cancellation', () => {
  it('returns the seat to the pool', async () => {
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
    expect(await seatsAvailable(pool.id)).toBe(1)

    expectStatus(await cancelRideReq(rafiq, rafiqRide.id), 200)
    expect(await seatsAvailable(pool.id)).toBe(2)
  })

  it('returns every seat of a multi-seat booking', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5,
    })
    const pool = await openPool(jashim, nusratRide.id)

    const rafiqRide = await bookRide(rafiq, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 2,
    })
    expectStatus(await joinPool(jashim, pool.id, rafiqRide.id), 201)
    expect(await seatsAvailable(pool.id)).toBe(0)

    expectStatus(await cancelRideReq(rafiq, rafiqRide.id), 200)
    expect(await seatsAvailable(pool.id)).toBe(2)
  })

  it('refuses to cancel once the passenger is aboard', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')

    const ride = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })
    const pool = await openPool(jashim, ride.id)
    expectStatus(await arriveReq(jashim, pool.id), 200)
    expectStatus(await startReq(jashim, pool.id), 200)

    const res = await cancelRideReq(nusrat, ride.id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVALID_TRANSITION')
  })
})

describe('roles and auth', () => {
  it('refuses a passenger on every driver endpoint', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')

    const attempts = [
      api().post('/pools').set('Authorization', `Bearer ${nusrat}`).send({
        rideRequestId: '00000000-0000-0000-0000-000000000000',
      }),
      requestFeedReq(nusrat),
      activePoolReq(nusrat),
      api().patch('/drivers/me').set('Authorization', `Bearer ${nusrat}`)
        .send({ isOnline: true, zoneId: banani }),
    ]

    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN_ROLE')
    }
  })

  it('refuses a driver on a passenger endpoint', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    const res = await myRidesReq(jashim)
    expect(res.status).toBe(403)
  })

  it('refuses a missing or broken token', async () => {
    expect((await api().get('/rides/mine')).status).toBe(401)

    const res = await api().get('/rides/mine').set('Authorization', 'Bearer not-a-token')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('booking rules', () => {
  it('rejects a second active booking from the same passenger', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1,
    })

    const res = await api().post('/rides')
      .set('Authorization', `Bearer ${nusrat}`)
      .send({ pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ALREADY_ACTIVE')
  })

  it('returns the original ride for a repeated idempotency key', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const body = { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 }

    const first = await api().post('/rides')
      .set('Authorization', `Bearer ${nusrat}`)
      .set('Idempotency-Key', 'nusrat-books-once')
      .send(body)
    expect(first.status).toBe(201)

    const replay = await api().post('/rides')
      .set('Authorization', `Bearer ${nusrat}`)
      .set('Idempotency-Key', 'nusrat-books-once')
      .send(body)
    expect(replay.status).toBe(201)
    expect(replay.body.ride.id).toBe(first.body.ride.id)

    const mine = expectStatus(await myRidesReq(nusrat), 200)
    expect(mine.body.rides).toHaveLength(1)
  })

  it('rejects an out-of-range seat count', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    for (const seats of [0, 4, -1]) {
      const res = await api().post('/rides')
        .set('Authorization', `Bearer ${nusrat}`)
        .send({ pickupZoneId: banani, destinationZoneId: mohakhali, seats })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
  })
})

describe('the driver request feed', () => {
  it('refuses an offline driver', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    const res = await requestFeedReq(jashim)
    expect(res.status).toBe(403)
  })

  it('requires a zone to go online', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    const res = await api().patch('/drivers/me')
      .set('Authorization', `Bearer ${jashim}`)
      .send({ isOnline: true })
    expect(res.status).toBe(422)
    expect(res.body.error.details).toHaveProperty('zoneId')
  })

  it('shows only requests from the driver’s own zone', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)

    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')
    await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    await bookRide(rafiq,  { pickupZoneId: gulshan, destinationZoneId: dhanmondi, seats: 1 })

    const res = expectStatus(await requestFeedReq(jashim), 200)
    expect(res.body.requests).toHaveLength(1)
    expect(res.body.requests[0].passengerName).toBe('Nusrat Jahan')
    expect(res.body.requests[0].joinable).toBe(true)
  })

  it('flags an opposite-direction request as unjoinable', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)

    // Nusrat heads north to Uttara.
    const nusrat = await tokenFor('Nusrat Jahan')
    const nusratRide = await bookRide(nusrat, {
      pickupZoneId: banani, destinationZoneId: world.zoneId('Uttara'), seats: 1, waitMinutes: 5,
    })
    await openPool(jashim, nusratRide.id)

    // Rafiq wants to go south to Dhanmondi.
    const rafiq = await tokenFor('Rafiq Hasan')
    await bookRide(rafiq, {
      pickupZoneId: banani, destinationZoneId: dhanmondi, seats: 1,
    })

    const res = expectStatus(await requestFeedReq(jashim), 200)
    const rafiqRow = res.body.requests.find(
      (r: { passengerName: string }) => r.passengerName === 'Rafiq Hasan',
    )
    expect(rafiqRow.joinable).toBe(false)
    expect(rafiqRow.reason).toMatch(/opposite direction/i)
  })
})

describe('zones', () => {
  it('is public and carries numeric coordinates for the direction radar', async () => {
    const res = expectStatus(await api().get('/zones'), 200)
    expect(res.body.zones).toHaveLength(8)
    expect(Object.keys(res.body.zones[0]).sort()).toEqual(['id', 'lat', 'lng', 'name'])
    const banani = res.body.zones.find((z: { name: string }) => z.name === 'Banani')
    expect(banani.lat).toBe(23.7937)
    expect(typeof banani.lng).toBe('number')
  })
})

describe('driver profile', () => {
  it('reports availability, zone and vehicle', async () => {
    const jashim = await tokenFor('Jashim Uddin')

    const offline = expectStatus(
      await api().get('/drivers/me').set('Authorization', `Bearer ${jashim}`), 200,
    )
    expect(offline.body.driver).toMatchObject({
      name: 'Jashim Uddin',
      isOnline: false,
      currentZone: null,
      vehicle: { name: 'Bullet', seatCapacity: 3 },
    })

    await goOnline(jashim, banani)
    const online = expectStatus(
      await api().get('/drivers/me').set('Authorization', `Bearer ${jashim}`), 200,
    )
    expect(online.body.driver.isOnline).toBe(true)
    expect(online.body.driver.currentZone).toEqual({ id: banani, name: 'Banani' })
  })
})
