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

/**
 * Query-string counterpart to validate(): coerces and checks req.query, then
 * hands the parsed, typed value to the handler via res.locals.query rather
 * than reassigning req.query, which Express treats as derived from its own
 * query-parser setting rather than a plain writable property.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      const details = formatZodError(result.error)
      return next(new ValidationError(details))
    }
    res.locals.query = result.data
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
