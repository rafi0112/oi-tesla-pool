import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { truncateAll, closeDb } from '../helpers/db'
import { api, expectStatus } from '../helpers/api'

beforeEach(truncateAll)
afterAll(closeDb)

const PASSENGER = {
  name: 'Farida Yasmin', email: 'farida@oitesla.test', password: 'Password123!',
  role: 'PASSENGER', gender: 'FEMALE',
}

const DRIVER = {
  name: 'Anwar Hossain', email: 'anwar@oitesla.test', password: 'Password123!',
  role: 'DRIVER', gender: 'MALE', vehicleName: 'Comet', seatCapacity: 3,
}

describe('POST /auth/register', () => {
  it('registers a passenger and logs them straight in', async () => {
    const res = expectStatus(await api().post('/auth/register').send(PASSENGER), 201)
    expect(res.body.token).toEqual(expect.any(String))
    expect(res.body.user).toEqual({
      id: expect.any(String), name: 'Farida Yasmin', email: 'farida@oitesla.test',
      role: 'PASSENGER', gender: 'FEMALE',
    })

    // The token works immediately — no separate login step required.
    const me = expectStatus(
      await api().get('/auth/me').set('Authorization', `Bearer ${res.body.token}`),
      200,
    )
    expect(me.body.user.email).toBe('farida@oitesla.test')
  })

  it('registers a driver together with their one vehicle', async () => {
    const res = expectStatus(await api().post('/auth/register').send(DRIVER), 201)
    expect(res.body.user.role).toBe('DRIVER')

    const profile = expectStatus(
      await api().get('/drivers/me').set('Authorization', `Bearer ${res.body.token}`),
      200,
    )
    expect(profile.body.driver.vehicle).toEqual({ name: 'Comet', seatCapacity: 3 })
  })

  it('refuses a driver registration with no vehicle info', async () => {
    const { vehicleName: _v, seatCapacity: _s, ...withoutVehicle } = DRIVER
    const res = await api().post('/auth/register').send(withoutVehicle)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details.vehicleName).toBeDefined()
    expect(res.body.error.details.seatCapacity).toBeDefined()
  })

  it('never requires vehicle info from a passenger', async () => {
    const res = await api().post('/auth/register').send(PASSENGER)
    expect(res.status).toBe(201)
  })

  it('refuses a second registration on the same email', async () => {
    expectStatus(await api().post('/auth/register').send(PASSENGER), 201)
    const again = await api().post('/auth/register').send(PASSENGER)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('rejects a password under 8 characters as 422', async () => {
    const res = await api().post('/auth/register').send({ ...PASSENGER, password: 'short' })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects an unknown gender as 422', async () => {
    const res = await api().post('/auth/register').send({ ...PASSENGER, gender: 'UNKNOWN' })
    expect(res.status).toBe(422)
  })
})

describe('POST /auth/login', () => {
  it('logs a freshly registered user back in with the same credentials', async () => {
    await api().post('/auth/register').send(PASSENGER)
    const res = expectStatus(
      await api().post('/auth/login').send({ email: PASSENGER.email, password: PASSENGER.password }),
      200,
    )
    expect(res.body.user.email).toBe(PASSENGER.email)
  })

  it('rejects the wrong password', async () => {
    await api().post('/auth/register').send(PASSENGER)
    const res = await api().post('/auth/login').send({ email: PASSENGER.email, password: 'WrongPassword1' })
    expect(res.status).toBe(401)
  })
})
