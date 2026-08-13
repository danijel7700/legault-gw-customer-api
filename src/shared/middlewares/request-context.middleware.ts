import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { logger } from '../logger/logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[\w.:-]{1,128}$/;

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get(REQUEST_ID_HEADER);
  const requestId =
    inbound !== undefined && REQUEST_ID_PATTERN.test(inbound) ? inbound : randomUUID();

  req.ctx = {
    requestId,
    log: logger.child({ requestId }),
    receivedAt: Date.now(),
  };

  req.validated = {};

  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
