import { Router } from 'express'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { availabilitySchema, setAvailabilityHandler } from '../controllers/driver.controller'

const router = Router()

router.use(authenticate, requireRole('DRIVER'))

router.patch('/me', validate(availabilitySchema), setAvailabilityHandler)

export default router
