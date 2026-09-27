import { Router } from 'express'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import {
  createPoolSchema, createPoolHandler,
  joinPoolSchema, joinPoolHandler,
  startTripHandler,
} from '../controllers/pool.controller'

const router = Router()

router.use(authenticate, requireRole('DRIVER'))

router.post('/',           validate(createPoolSchema), createPoolHandler)
router.post('/:id/rides',  validate(joinPoolSchema),   joinPoolHandler)
router.post('/:id/start',  startTripHandler)

export default router
