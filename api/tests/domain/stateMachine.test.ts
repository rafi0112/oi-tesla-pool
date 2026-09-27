import { describe, it, expect } from 'vitest'
import {
  assertTransition, canTransition,
  RIDE_TRANSITIONS, POOL_TRANSITIONS,
} from '../../src/domain/stateMachine'
import { AppError } from '../../src/errors'

describe('ride transitions', () => {
  it('rejects DROPPED_OFF -> PICKED_UP', () => {
    expect(() => assertTransition('ride', 'DROPPED_OFF', 'PICKED_UP')).toThrow(AppError)
  })

  it('reports INVALID_TRANSITION with a 409', () => {
    try {
      assertTransition('ride', 'DROPPED_OFF', 'PICKED_UP')
      expect.unreachable('should have thrown')
    } catch (err) {
      const e = err as AppError
      expect(e.code).toBe('INVALID_TRANSITION')
      expect(e.httpStatus).toBe(409)
    }
  })

  it('allows the happy path', () => {
    expect(canTransition('ride', 'REQUESTED', 'MATCHED')).toBe(true)
    expect(canTransition('ride', 'MATCHED', 'PICKED_UP')).toBe(true)
    expect(canTransition('ride', 'PICKED_UP', 'DROPPED_OFF')).toBe(true)
  })

  it('refuses to cancel a passenger who is already aboard', () => {
    expect(canTransition('ride', 'PICKED_UP', 'CANCELLED')).toBe(false)
  })

  it('allows cancelling before boarding', () => {
    expect(canTransition('ride', 'REQUESTED', 'CANCELLED')).toBe(true)
    expect(canTransition('ride', 'MATCHED', 'CANCELLED')).toBe(true)
  })

  it('treats DROPPED_OFF and CANCELLED as terminal', () => {
    expect(RIDE_TRANSITIONS['DROPPED_OFF']).toEqual([])
    expect(RIDE_TRANSITIONS['CANCELLED']).toEqual([])
  })

  it('rejects an unknown status', () => {
    expect(canTransition('ride', 'NOT_A_STATUS', 'MATCHED')).toBe(false)
  })
})

describe('pool transitions', () => {
  it('allows the happy path', () => {
    expect(canTransition('pool', 'FORMING', 'ACCEPTED')).toBe(true)
    expect(canTransition('pool', 'ACCEPTED', 'DRIVER_ARRIVED')).toBe(true)
    expect(canTransition('pool', 'DRIVER_ARRIVED', 'EN_ROUTE')).toBe(true)
    expect(canTransition('pool', 'EN_ROUTE', 'COMPLETED')).toBe(true)
  })

  it('refuses to skip DRIVER_ARRIVED', () => {
    expect(canTransition('pool', 'ACCEPTED', 'EN_ROUTE')).toBe(false)
  })

  it('refuses to close an already closed pool', () => {
    expect(canTransition('pool', 'ACCEPTED', 'ACCEPTED')).toBe(false)
  })

  it('refuses to cancel a trip that is under way', () => {
    expect(canTransition('pool', 'EN_ROUTE', 'CANCELLED')).toBe(false)
  })

  it('allows cancelling before departure', () => {
    expect(canTransition('pool', 'FORMING', 'CANCELLED')).toBe(true)
    expect(canTransition('pool', 'ACCEPTED', 'CANCELLED')).toBe(true)
    expect(canTransition('pool', 'DRIVER_ARRIVED', 'CANCELLED')).toBe(true)
  })

  it('treats COMPLETED and CANCELLED as terminal', () => {
    expect(POOL_TRANSITIONS['COMPLETED']).toEqual([])
    expect(POOL_TRANSITIONS['CANCELLED']).toEqual([])
  })
})
