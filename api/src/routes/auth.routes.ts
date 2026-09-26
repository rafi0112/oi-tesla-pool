import { Router } from 'express'
import { validate } from '../middleware/validate'
import { registerSchema, loginSchema } from '../services/auth.service'
import { registerHandler, loginHandler, meHandler } from '../controllers/auth.controller'

const router = Router()

router.post('/register', validate(registerSchema), registerHandler)
router.post('/login',    validate(loginSchema),    loginHandler)

// GET /auth/me — auth guard wired in C3
router.get('/me', meHandler)

export default router
