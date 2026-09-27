import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { setAvailability, availabilitySchema } from '../services/driver.service'
import { AuthedRequest } from './auth.controller'

export { availabilitySchema }

export async function setAvailabilityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const driver = await setAvailability(
      (req as AuthedRequest).user.id,
      req.body as z.infer<typeof availabilitySchema>,
    )
    res.json({ driver })
  } catch (err) {
    next(err)
  }
}
