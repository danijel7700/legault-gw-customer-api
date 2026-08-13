import type { ErrorCode } from '../constants/error-code.constant.js';

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface HttpErrorOptions {
  code?: ErrorCodeValue;
  details?: unknown;
  cause?: unknown;
  isOperational?: boolean;
}
