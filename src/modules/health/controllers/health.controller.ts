import type { RequestHandler } from 'express';

import { toPublicBrandConfig } from '../../../config/brand.config.js';
import { checkDatabaseConnection } from '../../../database/index.js';
import { ServiceUnavailableError } from '../../../shared/errors/index.js';
import type { VersionedParams } from '../../../shared/types/api.types.js';
import type { AsyncRequestHandler } from '../../../shared/utils/async-handler.util.js';
import type { HealthResponse, LivenessResponse, ReadinessResponse } from '../types/health.types.js';

export const getLiveness: RequestHandler = (_req, res) => {
  const body: LivenessResponse = { status: 'ok', uptime: Math.floor(process.uptime()) };

  res.status(200).json(body);
};

export const getReadiness: AsyncRequestHandler = async (_req, res) => {
  try {
    await checkDatabaseConnection();
  } catch (error) {
    throw new ServiceUnavailableError('Database is not reachable', { cause: error });
  }

  const body: ReadinessResponse = { status: 'ok', database: 'up' };

  res.status(200).json(body);
};

export const getHealth: RequestHandler<VersionedParams> = (req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    version: req.params.version,
    brand: req.brandConfig.brand,
    sfcc: toPublicBrandConfig(req.brandConfig),
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(body);
};
