import type { RequestHandler } from 'express';

import type { VersionedParams } from '../../../shared/types/api.types.js';
import { asyncHandler } from '../../../shared/utils/async-handler.util.js';
import { getValidated } from '../../../shared/utils/get-validated.util.js';
import * as customerService from '../services/customer.service.js';
import type { CustomerIdentity, UpdateMemberProfileRequest } from '../types/customer.types.js';

export const getProfile: RequestHandler<VersionedParams> = asyncHandler<VersionedParams>(
  async (req, res) => {
    const identity = getValidated<CustomerIdentity>(req, 'headers');

    const profile = await customerService.getCustomer(req.brandConfig, identity);

    res.status(200).json(profile);
  },
);

export const updateProfile: RequestHandler<VersionedParams> = asyncHandler<VersionedParams>(
  async (req, res) => {
    const identity = getValidated<CustomerIdentity>(req, 'headers');
    const request = getValidated<UpdateMemberProfileRequest>(req, 'body');

    const profile = await customerService.updateProfile(req.brandConfig, identity, request);

    res.status(200).json(profile);
  },
);
