import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors/index.js';
import type { ValidationIssue, ValidationSource } from '../types/validation.types.js';

export function validate<T>(schema: ZodType<T>, source: ValidationSource = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
        code: issue.code,
      }));

      next(new ValidationError(`Invalid request ${source}`, { details: issues }));
      return;
    }

    req.validated = { ...req.validated, [source]: result.data };
    next();
  };
}
