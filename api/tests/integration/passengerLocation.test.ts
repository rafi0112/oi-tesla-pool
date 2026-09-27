import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { truncateAll, seedWorld, closeDb, TestWorld } from '../helpers/db'
import {
  tokenFor, goOnline, bookRide, requestFeedReq,
  passengerProfileReq, setPassengerLocationReq, expectStatus,
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

describe('GET /passengers/me', () => {
  it('has no location before the passenger has ever booked or set one', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const res = expectStatus(await passengerProfileReq(nusrat), 200)
    expect(res.body.passenger.currentZone).toBeNull()
  })
})

describe('booking a ride updates the passenger’s current location', () => {
  it('sets currentZone to the pickup zone just booked from', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })

    const res = expectStatus(await passengerProfileReq(nusrat), 200)
    expect(res.body.passenger.currentZone).toEqual({ id: banani, name: 'Banani' })
  })

  it('updates again if a later booking (after the first is resolved) is from a different zone', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const first = await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })

    const { cancelRideReq } = await import('../helpers/api')
    await cancelRideReq(nusrat, first.id)

    await bookRide(nusrat, { pickupZoneId: gulshan, destinationZoneId: mohakhali, seats: 1 })

    const res = expectStatus(await passengerProfileReq(nusrat), 200)
    expect(res.body.passenger.currentZone).toEqual({ id: gulshan, name: 'Gulshan 1' })
  })
})

describe('PATCH /passengers/me — setting a location explicitly', () => {
  it('updates currentZone without requiring a booking', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const res = expectStatus(await setPassengerLocationReq(nusrat, gulshan), 200)
    expect(res.body.passenger.currentZone).toEqual({ id: gulshan, name: 'Gulshan 1' })

    const profile = expectStatus(await passengerProfileReq(nusrat), 200)
    expect(profile.body.passenger.currentZone).toEqual({ id: gulshan, name: 'Gulshan 1' })
  })

  it('404s on a zone that does not exist', async () => {
    const nusrat = await tokenFor('Nusrat Jahan')
    const res = await setPassengerLocationReq(nusrat, 999999)
    expect(res.status).toBe(404)
  })

  it('is passenger-only — a driver is refused', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    const res = await setPassengerLocationReq(jashim, banani)
    expect(res.status).toBe(403)
  })
})

describe('a driver sees requests only from their own selected zone', () => {
  it('shows a request from the zone the driver picked, and none from another', async () => {
    const jashim = await tokenFor('Jashim Uddin')
    const nusrat = await tokenFor('Nusrat Jahan')
    const rafiq  = await tokenFor('Rafiq Hasan')

    // Nusrat requests from Banani; Rafiq requests from Gulshan 1.
    await bookRide(nusrat, { pickupZoneId: banani, destinationZoneId: mohakhali, seats: 1 })
    await bookRide(rafiq,  { pickupZoneId: gulshan, destinationZoneId: mohakhali, seats: 1 })

    // Driver selects Banani as his current location.
    await goOnline(jashim, banani)
    const atBanani = expectStatus(await requestFeedReq(jashim), 200)
    expect(atBanani.body.requests).toHaveLength(1)
    expect(atBanani.body.requests[0].passengerName).toBe('Nusrat Jahan')

    // Driver moves to Gulshan 1 — now sees only Rafiq's request, not Nusrat's.
    await goOnline(jashim, gulshan)
    const atGulshan = expectStatus(await requestFeedReq(jashim), 200)
    expect(atGulshan.body.requests).toHaveLength(1)
    expect(atGulshan.body.requests[0].passengerName).toBe('Rafiq Hasan')
  })
})
