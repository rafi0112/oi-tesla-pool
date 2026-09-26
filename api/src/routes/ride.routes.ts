import { Router, Request, Response, NextFunction } from 'express'
import { validate } from '../middleware/validate'
import { quoteSchema, quoteHandler } from '../controllers/ride.controller'
import { getAllZones } from '../repositories/zone.repo'

const router = Router()

router.get('/zones', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const zones = await getAllZones()
    res.json({ zones })
  } catch (err) {
    next(err)
  }
})

router.post('/rides/quote', validate(quoteSchema), quoteHandler)

export default router
