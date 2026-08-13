import { Router } from 'express';

import { customerRouter } from '../modules/customer/index.js';
import { healthRouter } from '../modules/health/index.js';

export const v1Router: Router = Router({ mergeParams: true });

v1Router.use('/health', healthRouter);
v1Router.use('/member', customerRouter);
