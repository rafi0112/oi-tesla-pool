import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { UnauthenticatedError } from '../errors'
import { AuthedRequest } from '../controllers/auth.controller'

interface JwtPayload {
  sub: string
  role: string
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return next(new UnauthenticatedError())

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload
    ;(req as AuthedRequest).user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    next(new UnauthenticatedError())
  }
}
