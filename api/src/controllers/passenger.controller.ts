import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { getPassengerProfile, setPassengerLocation, setLocationSchema } from '../services/passenger.service'
import { AuthedRequest } from './auth.controller'

export { setLocationSchema }

export async function getPassengerProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const passenger = await getPassengerProfile((req as AuthedRequest).user.id)
    res.json({ passenger })
  } catch (err) {
    next(err)
  }
}

export async function setLocationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const passenger = await setPassengerLocation(
      (req as AuthedRequest).user.id,
      req.body as z.infer<typeof setLocationSchema>,
    )
    res.json({ passenger })
  } catch (err) {
    next(err)
  }
}
