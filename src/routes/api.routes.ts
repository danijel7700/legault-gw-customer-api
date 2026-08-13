import { Router, type NextFunction, type Request, type Response } from 'express';

import { livenessRouter } from '../modules/health/index.js';
import { validateBrand } from '../shared/middlewares/validate-brand.middleware.js';
import { validateVersion } from '../shared/middlewares/validate-version.middleware.js';
import type { ApiVersion } from '../shared/types/api.types.js';
import { isApiVersion } from '../shared/utils/api.util.js';

import { v1Router } from './v1.routes.js';

const VERSION_ROUTERS: Record<ApiVersion, Router> = {
  v1: v1Router,
};

export function createApiRouter(): Router {
  const router = Router();

  router.use('/health', livenessRouter);

  router.use('/:version', validateVersion, validateBrand, dispatchToVersion);

  return router;
}

function dispatchToVersion(req: Request, res: Response, next: NextFunction): void {
  const version = req.params.version;

  if (typeof version !== 'string' || !isApiVersion(version)) {
    next();
    return;
  }

  VERSION_ROUTERS[version](req, res, next);
}
