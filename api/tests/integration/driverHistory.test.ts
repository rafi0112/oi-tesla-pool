import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { truncateAll, seedWorld, addDriver, closeDb, TestWorld } from '../helpers/db'
import {
  tokenFor, login, goOnline, bookRide, openPool,
  arriveReq, startReq, dropoffReq, completeReq, cancelRideReq,
  driverHistoryReq, expectStatus,
} from '../helpers/api'

let world: TestWorld
let banani: number
let mohakhali: number

beforeEach(async () => {
  await truncateAll()
  world = await seedWorld(['Nusrat Jahan', 'Rafiq Hasan'])
  banani    = world.zoneId('Banani')
  mohakhali = world.zoneId('Mohakhali')
})

afterAll(closeDb)

describe('GET /drivers/history', () => {
  it('is empty for a driver who has never finished a trip', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    const res = expectStatus(await driverHistoryReq(jashim), 200)
    expect(res.body.pools).toEqual([])
  })

  it('lists a completed trip, with its passengers and fare, fetched fresh from the database', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    const pool = await openPool(jashim, ride.id)
    await arriveReq(jashim, pool.id)
    await startReq(jashim, pool.id)
    await dropoffReq(jashim, pool.id, ride.id)
    await completeReq(jashim, pool.id)

    // A second, still-active pool must not appear in history yet.
    const secondRide = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    await openPool(jashim, secondRide.id)

    const res = expectStatus(await driverHistoryReq(jashim), 200)
    expect(res.body.pools).toHaveLength(1)
    const entry = res.body.pools[0]
    expect(entry.id).toBe(pool.id)
    expect(entry.status).toBe('COMPLETED')
    expect(entry.passengers).toHaveLength(1)
    expect(entry.passengers[0].name).toBe('Nusrat Jahan')
    expect(entry.passengers[0].status).toBe('DROPPED_OFF')
    expect(entry.grossFarePaisa).toBeGreaterThan(0)
  })

  it('lists a cancelled pool too', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    const pool = await openPool(jashim, ride.id)

    expectStatus(await cancelRideReq(nusrat, ride.id), 200)

    const res = expectStatus(await driverHistoryReq(jashim), 200)
    expect(res.body.pools).toHaveLength(1)
    expect(res.body.pools[0].id).toBe(pool.id)
    expect(res.body.pools[0].status).toBe('CANCELLED')
  })

  it('scopes strictly to the calling driver — a second driver sees only their own trips', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const jashimRide = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    const jashimPool = await openPool(jashim, jashimRide.id)
    await arriveReq(jashim, jashimPool.id)
    await startReq(jashim, jashimPool.id)
    await dropoffReq(jashim, jashimPool.id, jashimRide.id)
    await completeReq(jashim, jashimPool.id)

    // A wholly separate driver, with their own vehicle, no relation to Jashim's trip.
    await addDriver('Kamal Mia')
    const kamal = await login('kamal@oitesla.test')
    await goOnline(kamal, banani)
    const rafiq = await tokenFor('Rafiq Hasan')
    const kamalRide = await bookRide(rafiq, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    const kamalPool = await openPool(kamal, kamalRide.id)
    await arriveReq(kamal, kamalPool.id)
    await startReq(kamal, kamalPool.id)
    await dropoffReq(kamal, kamalPool.id, kamalRide.id)
    await completeReq(kamal, kamalPool.id)

    const jashimHistory = expectStatus(await driverHistoryReq(jashim), 200)
    expect(jashimHistory.body.pools.map((p: { id: string }) => p.id)).toEqual([jashimPool.id])

    const kamalHistory = expectStatus(await driverHistoryReq(kamal), 200)
    expect(kamalHistory.body.pools.map((p: { id: string }) => p.id)).toEqual([kamalPool.id])

    // Neither driver's history mentions the other's passenger by name.
    expect(JSON.stringify(jashimHistory.body)).not.toMatch(/Rafiq/i)
    expect(JSON.stringify(kamalHistory.body)).not.toMatch(/Nusrat/i)
  })

  it('is driver-only: a passenger cannot call it', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const res = await driverHistoryReq(nusrat)
    expect(res.status).toBe(403)
  })
})
