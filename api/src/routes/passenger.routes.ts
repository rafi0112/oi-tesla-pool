import { Router } from 'express'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import {
  getPassengerProfileHandler, setLocationHandler, setLocationSchema,
} from '../controllers/passenger.controller'

const router = Router()

router.use(authenticate, requireRole('PASSENGER'))

router.get('/me',   getPassengerProfileHandler)
router.patch('/me', validate(setLocationSchema), setLocationHandler)

export default router
