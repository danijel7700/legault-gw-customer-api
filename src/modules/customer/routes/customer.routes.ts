import { Router } from 'express';

import { validate } from '../../../shared/middlewares/validate.middleware.js';
import {
  createAddress,
  deleteAddress,
  getProfile,
  setPreferredAddress,
  updateAddress,
  updateProfile,
} from '../controllers/customer.controller.js';
import {
  addressParamsSchema,
  createAddressSchema,
  updateAddressSchema,
} from '../validations/customer-address.validation.js';
import { customerIdentitySchema, updateProfileSchema } from '../validations/customer.validation.js';

export const customerRouter: Router = Router({ mergeParams: true });

const identity = validate(customerIdentitySchema, 'headers');

const addressId = validate(addressParamsSchema, 'params');

customerRouter.get('/profile', identity, getProfile);
customerRouter.patch('/profile', identity, validate(updateProfileSchema, 'body'), updateProfile);

customerRouter.post('/addresses', identity, validate(createAddressSchema, 'body'), createAddress);
customerRouter.patch(
  '/addresses/:id',
  identity,
  addressId,
  validate(updateAddressSchema, 'body'),
  updateAddress,
);
customerRouter.delete('/addresses/:id', identity, addressId, deleteAddress);
customerRouter.put('/addresses/:id/preferred', identity, addressId, setPreferredAddress);
