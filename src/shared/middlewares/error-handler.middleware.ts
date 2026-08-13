import type { ErrorRequestHandler } from 'express';

import {
  ErrorCode,
  type HttpError,
  InternalServerError,
  PayloadTooLargeError,
  ValidationError,
  isHttpError,
} from '../errors/index.js';
import { logger } from '../logger/logger.js';
import type { ErrorResponseBody } from '../types/error-response.types.js';
import type { RequestContext } from '../types/request-context.types.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const ctx = req.ctx as RequestContext | undefined;
  const requestId = ctx?.requestId ?? 'unknown';
  const log = ctx?.log ?? logger;

  const httpError = toHttpError(error);

  const logPayload = {
    err: error,
    statusCode: httpError.statusCode,
    code: httpError.code,
    method: req.method,
    url: req.originalUrl,
    durationMs: ctx ? Date.now() - ctx.receivedAt : undefined,
  };

  if (httpError.isOperational) {
    log.warn(logPayload, `Request failed: ${httpError.message}`);
  } else {
    log.error(logPayload, `Unhandled error: ${httpError.message}`);
  }

  const body: ErrorResponseBody = {
    error: {
      code: httpError.code,
      message: httpError.isOperational ? httpError.message : 'Internal server error',
      requestId,
    },
  };

  if (httpError.isOperational && httpError.details !== undefined) {
    body.error.details = httpError.details;
  }

  res.status(httpError.statusCode).json(body);
};

function toHttpError(error: unknown): HttpError {
  if (isHttpError(error)) {
    return error;
  }

  const bodyParserError = asBodyParserError(error);
  if (bodyParserError) {
    return bodyParserError;
  }

  return new InternalServerError('Internal server error', { cause: error });
}

interface BodyParserError extends Error {
  type: string;
  status?: number;
  statusCode?: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return error instanceof Error && typeof (error as Partial<BodyParserError>).type === 'string';
}

function asBodyParserError(error: unknown): HttpError | undefined {
  if (!isBodyParserError(error)) {
    return undefined;
  }

  switch (error.type) {
    case 'entity.too.large':
      return new PayloadTooLargeError('Request body exceeds the maximum allowed size', {
        cause: error,
      });
    case 'entity.parse.failed':
      return new ValidationError('Request body is not valid JSON', { cause: error });
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new ValidationError('Unsupported request encoding', {
        cause: error,
        code: ErrorCode.BAD_REQUEST,
      });
    default:
      return undefined;
  }
}
