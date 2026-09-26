import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { createPool, createPoolSchema } from '../services/pool.service'
import { AuthedRequest } from './auth.controller'

export { createPoolSchema }

export async function createPoolHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const driverId = (req as AuthedRequest).user.id
    const pool = await createPool(driverId, req.body as z.infer<typeof createPoolSchema>)
    res.status(201).json({ pool })
  } catch (err) {
    next(err)
  }
}
