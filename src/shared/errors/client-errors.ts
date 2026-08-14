import { ErrorCode } from './constants/error-code.constant.js';
import { HttpError } from './http-error.js';
import type { HttpErrorOptions } from './types/http-error.types.js';

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', options: HttpErrorOptions = {}) {
    super(400, message, { code: ErrorCode.BAD_REQUEST, ...options });
  }
}

export class ValidationError extends HttpError {
  constructor(message = 'Request validation failed', options: HttpErrorOptions = {}) {
    super(400, message, { code: ErrorCode.VALIDATION_ERROR, ...options });
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized', options: HttpErrorOptions = {}) {
    super(401, message, { code: ErrorCode.UNAUTHORIZED, ...options });
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', options: HttpErrorOptions = {}) {
    super(403, message, { code: ErrorCode.FORBIDDEN, ...options });
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Resource not found', options: HttpErrorOptions = {}) {
    super(404, message, { code: ErrorCode.NOT_FOUND, ...options });
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict', options: HttpErrorOptions = {}) {
    super(409, message, { code: ErrorCode.CONFLICT, ...options });
  }
}

export class UnprocessableEntityError extends HttpError {
  constructor(message = 'Unprocessable entity', options: HttpErrorOptions = {}) {
    super(422, message, { code: ErrorCode.UNPROCESSABLE_ENTITY, ...options });
  }
}

export class PreconditionFailedError extends HttpError {
  constructor(message = 'Precondition failed', options: HttpErrorOptions = {}) {
    super(412, message, { code: ErrorCode.PRECONDITION_FAILED, ...options });
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message = 'Payload too large', options: HttpErrorOptions = {}) {
    super(413, message, { code: ErrorCode.PAYLOAD_TOO_LARGE, ...options });
  }
}
