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
  body: { pickupZoneId: number; destinationZoneId: number; seats: number },
) {
  const res = await api()
    .post('/rides')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send(body)
  if (res.status !== 201) {
    throw new Error(`booking failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body.ride as { id: string; farePaisa: number; status: string }
}

export async function openPool(
  driverToken: string,
  rideRequestId: string,
  waitForPool: boolean,
) {
  const res = await api()
    .post('/pools')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ rideRequestId, waitForPool })
  if (res.status !== 201) {
    throw new Error(`pool creation failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body.pool as { id: string; seatsAvailable: number; status: string }
}

export function joinPool(driverToken: string, poolId: string, rideRequestId: string) {
  return api()
    .post(`/pools/${poolId}/rides`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ rideRequestId })
}
