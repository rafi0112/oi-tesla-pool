import request from 'supertest'
import { app } from '../../src/app'
import { TEST_PASSWORD } from './db'

export const api = () => request(app)

export async function login(email: string): Promise<string> {
  const res = await api().post('/auth/login').send({ email, password: TEST_PASSWORD })
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body.token
}

export function emailFor(name: string): string {
  return `${name.split(' ')[0].toLowerCase()}@oitesla.test`
}

export async function tokenFor(name: string): Promise<string> {
  return login(emailFor(name))
}

export async function goOnline(driverToken: string, zoneId: number) {
  return api()
    .patch('/drivers/me')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ isOnline: true, zoneId })
}

export async function bookRide(
  passengerToken: string,
  body: { pickupZoneId: number; destinationZoneId: number; seats: number; waitMinutes?: number },
) {
  const res = await api()
    .post('/rides')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send(body)
  if (res.status !== 201) {
    throw new Error(`booking failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body.ride as { id: string; farePaisa: number; status: string; poolId: string | null }
}

/** Like bookRide, but for calls that pass poolId and need to see joinAttempt too. */
export async function bookRideIntoPool(
  passengerToken: string,
  body: { pickupZoneId: number; destinationZoneId: number; seats: number; poolId: string; waitMinutes?: number },
) {
  const res = await api()
    .post('/rides')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send(body)
  if (res.status !== 201) {
    throw new Error(`booking failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body as {
    ride: { id: string; farePaisa: number; status: string; poolId: string | null }
    joinAttempt?: { ok: boolean; reason?: string; message?: string }
  }
}

export const nearbyPoolsReq = (
  token: string,
  q: { pickupZoneId: number; destinationZoneId: number; seats: number },
) =>
  api()
    .get('/pools/nearby')
    .query(q)
    .set('Authorization', `Bearer ${token}`)

export async function openPool(driverToken: string, rideRequestId: string) {
  const res = await api()
    .post('/pools')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ rideRequestId })
  if (res.status !== 201) {
    throw new Error(`pool creation failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body.pool as { id: string; seatsAvailable: number; status: string; waitUntil: string | null }
}

export function joinPool(driverToken: string, poolId: string, rideRequestId: string) {
  return api()
    .post(`/pools/${poolId}/rides`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ rideRequestId })
}

const poolAction = (token: string, poolId: string, action: string) =>
  api().post(`/pools/${poolId}/${action}`).set('Authorization', `Bearer ${token}`)

export const closePoolReq  = (t: string, p: string) => poolAction(t, p, 'close')
export const arriveReq     = (t: string, p: string) => poolAction(t, p, 'arrive')
export const startReq      = (t: string, p: string) => poolAction(t, p, 'start')
export const completeReq   = (t: string, p: string) => poolAction(t, p, 'complete')

export const dropoffReq = (token: string, poolId: string, rideId: string) =>
  api()
    .post(`/pools/${poolId}/rides/${rideId}/dropoff`)
    .set('Authorization', `Bearer ${token}`)

export const cancelRideReq = (token: string, rideId: string) =>
  api().post(`/rides/${rideId}/cancel`).set('Authorization', `Bearer ${token}`)

export const getRideReq = (token: string, rideId: string) =>
  api().get(`/rides/${rideId}`).set('Authorization', `Bearer ${token}`)

export const myRidesReq = (token: string) =>
  api().get('/rides/mine').set('Authorization', `Bearer ${token}`)

export const activePoolReq = (token: string) =>
  api().get('/pools/active').set('Authorization', `Bearer ${token}`)

export const requestFeedReq = (token: string) =>
  api().get('/drivers/requests').set('Authorization', `Bearer ${token}`)

export const passengerProfileReq = (token: string) =>
  api().get('/passengers/me').set('Authorization', `Bearer ${token}`)

export const setPassengerLocationReq = (token: string, zoneId: number) =>
  api().patch('/passengers/me').set('Authorization', `Bearer ${token}`).send({ zoneId })

/** Throws with the response body when the status is unexpected. */
export function expectStatus(res: { status: number; body: unknown }, want: number) {
  if (res.status !== want) {
    throw new Error(`expected ${want}, got ${res.status}: ${JSON.stringify(res.body)}`)
  }
  return res
}
