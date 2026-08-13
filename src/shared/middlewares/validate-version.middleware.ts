import type { NextFunction, Request, Response } from 'express';

import { API_VERSIONS } from '../constants/api.constant.js';
import { BadRequestError, ErrorCode } from '../errors/index.js';
import { isApiVersion } from '../utils/api.util.js';

export function validateVersion(req: Request, _res: Response, next: NextFunction): void {
  const version = req.params.version;

  if (typeof version !== 'string' || !isApiVersion(version)) {
    next(
      new BadRequestError(
        `Unsupported API version '${String(version ?? '')}'. Supported versions: ${API_VERSIONS.join(', ')}.`,
        { code: ErrorCode.UNSUPPORTED_API_VERSION },
      ),
    );
    return;
  }

  next();
}
