import { ErrorCode } from './constants/error-code.constant.js';
import { HttpError } from './http-error.js';
import type { HttpErrorOptions } from './types/http-error.types.js';

export class UpstreamError extends HttpError {
  constructor(message = 'Upstream service error', options: HttpErrorOptions = {}) {
    super(502, message, { code: ErrorCode.UPSTREAM_ERROR, isOperational: true, ...options });
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Service unavailable', options: HttpErrorOptions = {}) {
    super(503, message, { code: ErrorCode.SERVICE_UNAVAILABLE, isOperational: true, ...options });
  }
}

export class InternalServerError extends HttpError {
  constructor(message = 'Internal server error', options: HttpErrorOptions = {}) {
    super(500, message, { code: ErrorCode.INTERNAL_ERROR, ...options, isOperational: false });
  }
}
