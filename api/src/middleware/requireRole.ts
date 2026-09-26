import { Response, NextFunction } from 'express'
import { ForbiddenRoleError } from '../errors'
import { AuthedRequest } from '../controllers/auth.controller'
import { Request } from 'express'

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user
    if (!user || !roles.includes(user.role)) return next(new ForbiddenRoleError())
    next()
  }
}
