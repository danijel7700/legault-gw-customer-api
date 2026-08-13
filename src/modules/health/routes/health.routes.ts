import { Router } from 'express';

import { asyncHandler } from '../../../shared/utils/async-handler.util.js';
import { getHealth, getLiveness, getReadiness } from '../controllers/health.controller.js';

export const healthRouter: Router = Router({ mergeParams: true });

healthRouter.get('/', getHealth);

export const livenessRouter: Router = Router();

livenessRouter.get('/', getLiveness);
livenessRouter.get('/ready', asyncHandler(getReadiness));
