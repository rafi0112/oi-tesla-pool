export class AppError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  constructor(details: Record<string, unknown> = {}) {
    super(422, 'VALIDATION_ERROR', 'Validation failed', details)
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Missing or invalid token') {
    super(401, 'UNAUTHENTICATED', message)
  }
}

export class ForbiddenRoleError extends AppError {
  constructor(message = 'Insufficient role') {
    super(403, 'FORBIDDEN_ROLE', message)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message)
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(409, code, message, details)
  }
}
