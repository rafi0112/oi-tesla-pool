import { Router } from 'express'
import { validate } from '../middleware/validate'
import { completeProfileSchema, meHandler, completeProfileHandler } from '../controllers/auth.controller'
import { authenticate } from '../middleware/auth'

const router = Router()

// No /register or /login here any more — the frontend talks to Supabase
// Auth directly for those (supabase-js signUp() / signInWithPassword() /
// signInWithOAuth()). This router only ever reads or completes a profile
// for a token Supabase Auth has already issued.
router.get('/me', authenticate, meHandler)
router.post('/complete-profile', authenticate, validate(completeProfileSchema), completeProfileHandler)

export default router
