import { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors'

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({
      error: { code: err.code, message: err.message, details: err.details },
    })
    return
  }

  // Unexpected error — log it, never expose the stack
  const logger = (_req as unknown as { log?: { error: (obj: unknown, msg: string) => void } }).log
  if (logger?.error) {
    logger.error(err, 'unhandled error')
  } else {
    console.error(err)
  }

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: {} },
  })
}
