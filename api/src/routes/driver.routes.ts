import { Router } from 'express'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import {
  availabilitySchema, setAvailabilityHandler,
  requestFeedHandler, getProfileHandler, historyHandler,
} from '../controllers/driver.controller'

const router = Router()

router.use(authenticate, requireRole('DRIVER'))

router.get('/me',         getProfileHandler)
router.patch('/me',       validate(availabilitySchema), setAvailabilityHandler)
router.get('/requests',   requestFeedHandler)
router.get('/history',    historyHandler)

export default router
