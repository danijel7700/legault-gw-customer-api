import { Router } from 'express';

import { getHealth, getLiveness } from '../controllers/health.controller.js';

export const healthRouter: Router = Router({ mergeParams: true });

healthRouter.get('/', getHealth);

export const livenessRouter: Router = Router();

livenessRouter.get('/', getLiveness);
