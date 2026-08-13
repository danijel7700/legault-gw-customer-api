import type { NextFunction, Request, Response } from 'express';

import { getBrandConfig } from '../../config/brand.config.js';
import { BadRequestError, ErrorCode } from '../errors/index.js';

export const BRAND_HEADER = 'x-brand';

export function validateBrand(req: Request, _res: Response, next: NextFunction): void {
  const brand = req.get(BRAND_HEADER);

  if (brand === undefined || brand.length === 0) {
    next(new BadRequestError(`Missing ${BRAND_HEADER} header`, { code: ErrorCode.MISSING_BRAND }));
    return;
  }

  req.brandConfig = getBrandConfig(brand.trim().toLowerCase());

  next();
}
