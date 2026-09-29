import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { getMe, completeProfile, completeProfileSchema } from '../services/auth.service'

// req.user is attached by auth middleware, which verifies the token with
// Supabase Auth and looks up this app's own role for it (see middleware/auth.ts).
export interface AuthedRequest extends Request {
  user: { id: string; role: string }
}

export { completeProfileSchema }

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getMe((req as AuthedRequest).user.id)
    res.json({ user })
  } catch (err) {
    next(err)
  }
}

export async function completeProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await completeProfile(
      (req as AuthedRequest).user.id,
      req.body as z.infer<typeof completeProfileSchema>,
    )
    res.json({ user })
  } catch (err) {
    next(err)
  }
}
