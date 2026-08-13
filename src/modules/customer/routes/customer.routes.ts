import { Router } from 'express';

import { validate } from '../../../shared/middlewares/validate.middleware.js';
import { getProfile } from '../controllers/customer.controller.js';
import { customerIdentitySchema } from '../validations/customer.validation.js';

export const customerRouter: Router = Router({ mergeParams: true });

customerRouter.get('/profile', validate(customerIdentitySchema, 'headers'), getProfile);
