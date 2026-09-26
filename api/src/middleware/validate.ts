import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'
import { ValidationError } from '../errors'

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const details = formatZodError(result.error)
      return next(new ValidationError(details))
    }
    req.body = result.data
    next()
  }
}

function formatZodError(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_root'
    out[key] ??= []
    out[key].push(issue.message)
  }
  return out
}
