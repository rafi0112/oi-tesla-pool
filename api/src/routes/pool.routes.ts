import { Router } from 'express'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { createPoolSchema, createPoolHandler } from '../controllers/pool.controller'

const router = Router()

router.use(authenticate, requireRole('DRIVER'))

router.post('/', validate(createPoolSchema), createPoolHandler)

export default router
