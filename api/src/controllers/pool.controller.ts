import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import {
  createPool, createPoolSchema,
  joinPool, joinPoolSchema,
  startTrip, closePool, markArrived,
  dropOffPassenger, completeTrip, getActivePool,
  findNearbyPools,
} from '../services/pool.service'
import { POOL_POLICY } from '../domain/matching'
import { AuthedRequest } from './auth.controller'

export { createPoolSchema, joinPoolSchema }

export const nearbyPoolsQuerySchema = z.object({
  pickupZoneId:      z.coerce.number().int().positive(),
  destinationZoneId: z.coerce.number().int().positive(),
  seats:             z.coerce.number().int().min(1).max(POOL_POLICY.maxSeatsPerBooking),
})

export async function nearbyPoolsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { pickupZoneId, destinationZoneId, seats } =
      res.locals.query as z.infer<typeof nearbyPoolsQuerySchema>
    const pools = await findNearbyPools(pickupZoneId, destinationZoneId, seats)
    res.json({ pools })
  } catch (err) {
    next(err)
  }
}

export async function createPoolHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const driverId = (req as AuthedRequest).user.id
    const pool = await createPool(driverId, req.body as z.infer<typeof createPoolSchema>)
    res.status(201).json({ pool })
  } catch (err) {
    next(err)
  }
}

export async function activePoolHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await getActivePool((req as AuthedRequest).user.id)
    res.json({ pool })
  } catch (err) {
    next(err)
  }
}

export async function closePoolHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await closePool((req as AuthedRequest).user.id, req.params.id)
    res.json({ pool })
  } catch (err) {
    next(err)
  }
}

export async function arriveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await markArrived((req as AuthedRequest).user.id, req.params.id)
    res.json({ pool })
  } catch (err) {
    next(err)
  }
}

export async function dropoffHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await dropOffPassenger(
      (req as AuthedRequest).user.id,
      req.params.id,
      req.params.rideId,
    )
    res.json({ pool })
  } catch (err) {
    next(err)
  }
}

export async function completeTripHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await completeTrip((req as AuthedRequest).user.id, req.params.id)
    res.json({ pool })
  } catch (err) {
    next(err)
  }
}

export async function startTripHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pool = await startTrip((req as AuthedRequest).user.id, req.params.id)
    res.json({ pool })
  } catch (err) {
    next(err)
  }
}

export async function joinPoolHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const driverId = (req as AuthedRequest).user.id
    const pool = await joinPool(
      driverId,
      req.params.id,
      req.body as z.infer<typeof joinPoolSchema>,
    )
    res.status(201).json({ pool })
  } catch (err) {
    next(err)
  }
}
