import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { truncateAll, seedWorld, closeDb, TestWorld } from '../helpers/db'
import {
  tokenFor, goOnline, bookRide, openPool, joinPool,
  arriveReq, startReq, dropoffReq, completeReq,
  getRideReq, submitFeedbackReq, expectStatus,
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

/** Books, matches, arrives, starts and drops off Nusrat — leaves her ride DROPPED_OFF. */
async function driveNusratToDropOff() {
  const jashim = await tokenFor('Jashim Uddin')
  await goOnline(jashim, banani)
  const nusrat = await tokenFor('Nusrat Jahan')

  const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
  const pool = await openPool(jashim, ride.id)
  await arriveReq(jashim, pool.id)
  await startReq(jashim, pool.id)
  await dropoffReq(jashim, pool.id, ride.id)

  return { jashim, nusrat, ride, pool }
}

describe('POST /rides/:id/feedback', () => {
  it('refuses feedback before the passenger has been dropped off', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const ride = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })

    // Still REQUESTED.
    const early = await submitFeedbackReq(nusrat, ride.id, { rating: 5 })
    expect(early.status).toBe(409)
    expect(early.body.error.code).toBe('NOT_DROPPED_OFF')

    // MATCHED, then PICKED_UP — still refused either way.
    const pool = await openPool(jashim, ride.id)
    expect((await submitFeedbackReq(nusrat, ride.id, { rating: 5 })).status).toBe(409)
    await arriveReq(jashim, pool.id)
    await startReq(jashim, pool.id)
    expect((await submitFeedbackReq(nusrat, ride.id, { rating: 5 })).status).toBe(409)
  })

  it('accepts feedback once dropped off, and it is stored and read back', async () => {
    const { nusrat, ride } = await driveNusratToDropOff()

    const res = expectStatus(
      await submitFeedbackReq(nusrat, ride.id, { rating: 4, comment: 'Smooth ride, friendly driver.' }),
      201,
    )
    expect(res.body.ride.feedback).toEqual({
      rating: 4, comment: 'Smooth ride, friendly driver.', createdAt: expect.any(String),
    })
    expect(res.body.ride.canGiveFeedback).toBe(false)

    // Comes back the same way on a fresh read — it's really in the database.
    const view = expectStatus(await getRideReq(nusrat, ride.id), 200)
    expect(view.body.ride.feedback.rating).toBe(4)
    expect(view.body.ride.canGiveFeedback).toBe(false)
  })

  it('allows feedback with no comment', async () => {
    const { nusrat, ride } = await driveNusratToDropOff()
    const res = expectStatus(await submitFeedbackReq(nusrat, ride.id, { rating: 3 }), 201)
    expect(res.body.ride.feedback).toEqual({ rating: 3, comment: null, createdAt: expect.any(String) })
  })

  it('refuses a second rating for the same ride', async () => {
    const { nusrat, ride } = await driveNusratToDropOff()
    expectStatus(await submitFeedbackReq(nusrat, ride.id, { rating: 5 }), 201)

    const again = await submitFeedbackReq(nusrat, ride.id, { rating: 1 })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('FEEDBACK_ALREADY_GIVEN')
  })

  it('rejects an out-of-range rating as 422', async () => {
    const { nusrat, ride } = await driveNusratToDropOff()
    const res = await submitFeedbackReq(nusrat, ride.id, { rating: 6 })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('will not let one passenger rate another passenger’s ride', async () => {
    const { ride } = await driveNusratToDropOff()
    const rafiq = await tokenFor('Rafiq Hasan')

    const res = await submitFeedbackReq(rafiq, ride.id, { rating: 5 })
    expect(res.status).toBe(404)
  })
})

describe('co-passenger privacy in the ride view', () => {
  it('reports a shared rider’s gender, never their name', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    await goOnline(jashim, banani)
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    const nusratRide = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1, waitMinutes: 5 })
    const pool = await openPool(jashim, nusratRide.id)
    const rafiqRide = await bookRide(rafiq, { pickupZoneId: banani, destinationZoneId: gulshan, seats: 1 })
    await joinPool(jashim, pool.id, rafiqRide.id)

    const view = expectStatus(await getRideReq(nusrat, nusratRide.id), 200)
    expect(view.body.ride.sharedGenders).toEqual(['MALE'])
    expect(JSON.stringify(view.body.ride)).not.toMatch(/Rafiq/i)
  })
})
