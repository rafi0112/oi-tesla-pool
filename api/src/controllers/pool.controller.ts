import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { createPool, createPoolSchema, joinPool, joinPoolSchema } from '../services/pool.service'
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
