import type { RequestHandler } from 'express';

import type { VersionedParams } from '../../../shared/types/api.types.js';
import { asyncHandler } from '../../../shared/utils/async-handler.util.js';
import { getValidated } from '../../../shared/utils/get-validated.util.js';
import * as customerService from '../services/customer.service.js';
import type {
  CreateMemberAddressRequest,
  CustomerIdentity,
  UpdateMemberAddressRequest,
  UpdateMemberProfileRequest,
} from '../types/customer.types.js';

interface AddressParams {
  readonly id: string;
}

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

export const createAddress: RequestHandler<VersionedParams> = asyncHandler<VersionedParams>(
  async (req, res) => {
    const identity = getValidated<CustomerIdentity>(req, 'headers');
    const request = getValidated<CreateMemberAddressRequest>(req, 'body');

    const address = await customerService.createAddress(req.brandConfig, identity, request);

    res.status(201).json(address);
  },
);

export const updateAddress: RequestHandler<VersionedParams> = asyncHandler<VersionedParams>(
  async (req, res) => {
    const identity = getValidated<CustomerIdentity>(req, 'headers');
    const { id } = getValidated<AddressParams>(req, 'params');
    const request = getValidated<UpdateMemberAddressRequest>(req, 'body');

    const address = await customerService.updateAddress(req.brandConfig, identity, id, request);

    res.status(200).json(address);
  },
);

export const deleteAddress: RequestHandler<VersionedParams> = asyncHandler<VersionedParams>(
  async (req, res) => {
    const identity = getValidated<CustomerIdentity>(req, 'headers');
    const { id } = getValidated<AddressParams>(req, 'params');

    await customerService.deleteAddress(req.brandConfig, identity, id);

    res.status(204).end();
  },
);

export const setPreferredAddress: RequestHandler<VersionedParams> = asyncHandler<VersionedParams>(
  async (req, res) => {
    const identity = getValidated<CustomerIdentity>(req, 'headers');
    const { id } = getValidated<AddressParams>(req, 'params');

    const address = await customerService.setPreferredAddress(req.brandConfig, identity, id);

    res.status(200).json(address);
  },
);
