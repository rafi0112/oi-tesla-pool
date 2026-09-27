import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { truncateAll, seedWorld, seatsAvailable, closeDb, TestWorld } from '../helpers/db'
import { tokenFor, goOnline, bookRide, openPool, joinPool } from '../helpers/api'

// Nusrat takes two of Bullet's three seats, leaving exactly one. Five more
// passengers then race for it.
const CONTENDERS = [
  'Rafiq Hasan',
  'Shirin Akter',
  'Tania Rahman',
  'Imran Hossain',
  'Sabina Yesmin',
]

let world: TestWorld

beforeEach(async () => {
  await truncateAll()
  world = await seedWorld(['Nusrat Jahan', ...CONTENDERS])
})

afterAll(closeDb)

describe('concurrent claims on the last seat', () => {
  it('lets exactly one of five joins win', async () => {
    const banani = world.zoneId('Banani')
    const mohakhali = world.zoneId('Mohakhali')

    const driverToken = await tokenFor('Jashim Uddin')
    await goOnline(driverToken, banani)

    // Nusrat books two seats, so the pool opens with one seat left.
    const nusratToken = await tokenFor('Nusrat Jahan')
    const nusratRide = await bookRide(nusratToken, {
      pickupZoneId: banani,
      destinationZoneId: mohakhali,
      seats: 2,
      waitMinutes: 5,
    })

    const pool = await openPool(driverToken, nusratRide.id)
    expect(pool.seatsAvailable).toBe(1)
    expect(pool.status).toBe('FORMING')

    // Five separate passengers each want that one seat.
    const rideIds: string[] = []
    for (const name of CONTENDERS) {
      const token = await tokenFor(name)
      const ride = await bookRide(token, {
        pickupZoneId: banani,
        destinationZoneId: mohakhali,
        seats: 1,
      })
      rideIds.push(ride.id)
    }

    const results = await Promise.all(
      rideIds.map(id => joinPool(driverToken, pool.id, id)),
    )

    const statuses = results.map(r => r.status).sort()
    const winners = results.filter(r => r.status === 201)
    const losers = results.filter(r => r.status === 409)

    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(4)
    expect(statuses).toEqual([201, 409, 409, 409, 409])

    for (const loser of losers) {
      expect(loser.body.error.code).toBe('POOL_FULL')
    }

    expect(await seatsAvailable(pool.id)).toBe(0)
  })

  it('leaves the losing rides untouched and still cancellable', async () => {
    const banani = world.zoneId('Banani')
    const mohakhali = world.zoneId('Mohakhali')

    const driverToken = await tokenFor('Jashim Uddin')
    await goOnline(driverToken, banani)

    const nusratToken = await tokenFor('Nusrat Jahan')
    const nusratRide = await bookRide(nusratToken, {
      pickupZoneId: banani,
      destinationZoneId: mohakhali,
      seats: 2,
      waitMinutes: 5,
    })
    const pool = await openPool(driverToken, nusratRide.id)

    const contenders: { name: string; rideId: string; token: string }[] = []
    for (const name of CONTENDERS) {
      const token = await tokenFor(name)
      const ride = await bookRide(token, {
        pickupZoneId: banani,
        destinationZoneId: mohakhali,
        seats: 1,
      })
      contenders.push({ name, rideId: ride.id, token })
    }

    const results = await Promise.all(
      contenders.map(c => joinPool(driverToken, pool.id, c.rideId)),
    )

    // Whoever lost should still be REQUESTED, not half-joined to the pool.
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== 409) continue
      const { token, rideId } = contenders[i]
      const res = await fetchRide(token, rideId)
      expect(res.ride.status).toBe('REQUESTED')
      expect(res.ride.poolId).toBeNull()
      expect(res.ride.canCancel).toBe(true)
    }
  })
})

async function fetchRide(token: string, rideId: string) {
  const { api } = await import('../helpers/api')
  const res = await api()
    .get(`/rides/${rideId}`)
    .set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(200)
  return res.body as { ride: { status: string; poolId: string | null; canCancel: boolean } }
}
