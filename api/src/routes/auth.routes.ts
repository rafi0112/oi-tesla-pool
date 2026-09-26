import { Router } from 'express'
import { validate } from '../middleware/validate'
import { registerSchema, loginSchema } from '../services/auth.service'
import { registerHandler, loginHandler, meHandler } from '../controllers/auth.controller'
import { authenticate } from '../middleware/auth'

const router = Router()

router.post('/register', validate(registerSchema), registerHandler)
router.post('/login',    validate(loginSchema),    loginHandler)
router.get('/me',        authenticate,             meHandler)

export default router
