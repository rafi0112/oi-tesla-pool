import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import {
  createPool, createPoolSchema,
  joinPool, joinPoolSchema,
  startTrip, closePool, markArrived,
  dropOffPassenger, completeTrip, getActivePool,
} from '../services/pool.service'
import { AuthedRequest } from './auth.controller'

export { createPoolSchema, joinPoolSchema }

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
