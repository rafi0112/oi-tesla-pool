import { ConflictError } from '../errors'

export const RIDE_TRANSITIONS: Record<string, readonly string[]> = {
  REQUESTED:   ['MATCHED', 'CANCELLED'],
  MATCHED:     ['PICKED_UP', 'CANCELLED'],
  PICKED_UP:   ['DROPPED_OFF'],
  DROPPED_OFF: [],
  CANCELLED:   [],
}

export const POOL_TRANSITIONS: Record<string, readonly string[]> = {
  // DRIVER_ARRIVED is reachable straight from FORMING — a driver can
  // physically arrive at the pickup before the wait window has run out or
  // been closed. See pool.service.ts's markArrived, which also clears
  // wait_until whenever it fires from FORMING, since arriving ends the
  // waiting window regardless of how much time was left on it.
  FORMING:        ['ACCEPTED', 'DRIVER_ARRIVED', 'CANCELLED'],
  ACCEPTED:       ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE:       ['COMPLETED'],
  COMPLETED:      [],
  CANCELLED:      [],
}

export type TransitionKind = 'ride' | 'pool'

export function allowedTransitions(kind: TransitionKind, from: string): readonly string[] {
  const table = kind === 'ride' ? RIDE_TRANSITIONS : POOL_TRANSITIONS
  return table[from] ?? []
}

export function canTransition(kind: TransitionKind, from: string, to: string): boolean {
  return allowedTransitions(kind, from).includes(to)
}

export function assertTransition(kind: TransitionKind, from: string, to: string): void {
  if (!canTransition(kind, from, to)) {
    throw new ConflictError(
      'INVALID_TRANSITION',
      `Cannot move ${kind} from ${from} to ${to}`,
      { from, to },
    )
  }
}
