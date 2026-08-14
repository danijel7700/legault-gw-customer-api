import type { BrandConfig } from '../../config/types/brand.types.js';
import type {
  CustomerIdentity,
  SfccAddressCreate,
  SfccAddressRecord,
  SfccAddressUpdate,
  SfccCustomerRecord,
  SfccCustomerUpdate,
} from '../../modules/customer/types/customer.types.js';
import type { Brand } from '../../shared/types/api.types.js';

import { createCustomersClient, type CustomersClient } from './clients/customers.client.js';
import {
  toCreateAddressRequest,
  toSfccAddressRecord,
  toSfccCustomerRecord,
  toUpdateAddressRequest,
  toUpdateCustomerRequest,
} from './mappers/customer.mapper.js';

export interface SfccProvider {
  getCustomer(identity: CustomerIdentity): Promise<SfccCustomerRecord>;

  updateCustomer(
    identity: CustomerIdentity,
    update: SfccCustomerUpdate,
  ): Promise<SfccCustomerRecord>;

  createAddress(identity: CustomerIdentity, address: SfccAddressCreate): Promise<SfccAddressRecord>;

  updateAddress(
    identity: CustomerIdentity,
    addressName: string,
    update: SfccAddressUpdate,
  ): Promise<SfccAddressRecord>;

  deleteAddress(identity: CustomerIdentity, addressName: string): Promise<void>;
}

const providers = new Map<Brand, SfccProvider>();

export function getSfccProvider(brandConfig: BrandConfig): SfccProvider {
  const cached = providers.get(brandConfig.brand);

  if (cached !== undefined) {
    return cached;
  }

  const provider = createSfccProvider(brandConfig);
  providers.set(brandConfig.brand, provider);

  return provider;
}

function createSfccProvider(brandConfig: BrandConfig): SfccProvider {
  const customers: CustomersClient = createCustomersClient(brandConfig);

  return {
    getCustomer: async ({ customerId, accessToken }) =>
      toSfccCustomerRecord(await customers.getCustomer(accessToken, customerId)),

    updateCustomer: async ({ customerId, accessToken }, update) =>
      toSfccCustomerRecord(
        await customers.updateCustomer(accessToken, customerId, toUpdateCustomerRequest(update)),
      ),

    createAddress: async ({ customerId, accessToken }, address) =>
      toSfccAddressRecord(
        await customers.createAddress(accessToken, customerId, toCreateAddressRequest(address)),
      ),

    updateAddress: async ({ customerId, accessToken }, addressName, update) =>
      toSfccAddressRecord(
        await customers.updateAddress(
          accessToken,
          customerId,
          addressName,
          toUpdateAddressRequest(update),
        ),
      ),

    deleteAddress: async ({ customerId, accessToken }, addressName): Promise<void> => {
      await customers.deleteAddress(accessToken, customerId, addressName);
    },
  };
}
