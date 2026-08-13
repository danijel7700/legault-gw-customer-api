import type { Request } from 'express';

import type { ValidationSource } from '../types/validation.types.js';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function getValidated<T>(req: Request, source: ValidationSource = 'body'): T {
  const value = req.validated[source];

  if (value === undefined) {
    throw new Error(
      `No validated ${source} on this request. ` +
        `Add validate(schema, '${source}') to the route before this handler.`,
    );
  }

  return value as T;
}
