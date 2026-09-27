import { Router, Request, Response, NextFunction } from 'express'
import { validate } from '../middleware/validate'
import {
  quoteSchema, quoteHandler,
  createRideSchema, createRideHandler,
  getMyRidesHandler, getRideByIdHandler, cancelRideHandler,
} from '../controllers/ride.controller'
import { getAllZones } from '../repositories/zone.repo'
import { toZoneDTO } from '../dto/zone.dto'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'

const router = Router()

router.get('/zones', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const zones = await getAllZones()
    res.json({ zones: zones.map(toZoneDTO) })
  } catch (err) {
    next(err)
  }
})

router.post('/rides/quote', validate(quoteSchema), quoteHandler)

// Passenger ride endpoints
router.post('/rides',       authenticate, requireRole('PASSENGER'), validate(createRideSchema), createRideHandler)
router.get('/rides/mine',   authenticate, requireRole('PASSENGER'), getMyRidesHandler)
router.get('/rides/:id',    authenticate, requireRole('PASSENGER'), getRideByIdHandler)
router.post('/rides/:id/cancel', authenticate, requireRole('PASSENGER'), cancelRideHandler)

export default router
