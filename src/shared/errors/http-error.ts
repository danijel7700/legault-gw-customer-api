import { ErrorCode } from './constants/error-code.constant.js';
import type { ErrorCodeValue, HttpErrorOptions } from './types/http-error.types.js';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCodeValue;
  readonly details: unknown;
  readonly isOperational: boolean;

  constructor(statusCode: number, message: string, options: HttpErrorOptions = {}) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);

    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = options.code ?? ErrorCode.INTERNAL_ERROR;
    this.details = options.details;
    this.isOperational = options.isOperational ?? statusCode < 500;

    Error.captureStackTrace(this, new.target);
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}
