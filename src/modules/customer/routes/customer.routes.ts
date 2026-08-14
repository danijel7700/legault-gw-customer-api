import { Router } from 'express';

import { validate } from '../../../shared/middlewares/validate.middleware.js';
import { getProfile, updateProfile } from '../controllers/customer.controller.js';
import { customerIdentitySchema, updateProfileSchema } from '../validations/customer.validation.js';

export const customerRouter: Router = Router({ mergeParams: true });

customerRouter.get('/profile', validate(customerIdentitySchema, 'headers'), getProfile);

customerRouter.patch(
  '/profile',
  validate(customerIdentitySchema, 'headers'),
  validate(updateProfileSchema, 'body'),
  updateProfile,
);
