import { Request, Response, NextFunction } from 'express'
import { register, login, getMe } from '../services/auth.service'

// req.user is attached by auth middleware (C3)
export interface AuthedRequest extends Request {
  user: { id: string; role: string }
}

export async function registerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await register(req.body)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
}

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await login(req.body)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getMe((req as AuthedRequest).user.id)
    res.json({ user })
  } catch (err) {
    next(err)
  }
}
