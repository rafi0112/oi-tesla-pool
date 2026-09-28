import { Router } from 'express'
import { validate, validateQuery } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import {
  createPoolSchema, createPoolHandler,
  joinPoolSchema, joinPoolHandler,
  activePoolHandler, closePoolHandler, arriveHandler,
  startTripHandler, dropoffHandler, completeTripHandler,
  nearbyPoolsQuerySchema, nearbyPoolsHandler,
  urgencyHandler,
} from '../controllers/pool.controller'

const router = Router()

router.use(authenticate)

// Passenger: browse joinable pools before booking. Must precede the blanket
// driver-only guard below, and precede any /:id route so "nearby" is never
// read as a pool id.
router.get('/nearby', requireRole('PASSENGER'), validateQuery(nearbyPoolsQuerySchema), nearbyPoolsHandler)

// Any current member may press this, not just the driver — must also precede
// the blanket driver-only guard below.
router.post('/:id/urgent', requireRole('PASSENGER'), urgencyHandler)

router.use(requireRole('DRIVER'))

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
