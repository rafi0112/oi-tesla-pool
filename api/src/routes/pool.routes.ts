import { Router } from 'express'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import {
  createPoolSchema, createPoolHandler,
  joinPoolSchema, joinPoolHandler,
  activePoolHandler, closePoolHandler, arriveHandler,
  startTripHandler, dropoffHandler, completeTripHandler,
} from '../controllers/pool.controller'

const router = Router()

router.use(authenticate, requireRole('DRIVER'))

// Must precede any /:id route so "active" is not read as a pool id.
router.get('/active', activePoolHandler)

router.post('/', validate(createPoolSchema), createPoolHandler)

router.post('/:id/rides',    validate(joinPoolSchema), joinPoolHandler)
router.post('/:id/close',    closePoolHandler)
router.post('/:id/arrive',   arriveHandler)
router.post('/:id/start',    startTripHandler)
router.post('/:id/complete', completeTripHandler)
router.post('/:id/rides/:rideId/dropoff', dropoffHandler)

export default router
