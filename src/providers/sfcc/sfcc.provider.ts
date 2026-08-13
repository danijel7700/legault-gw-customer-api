import type { BrandConfig } from '../../config/types/brand.types.js';
import type {
  CustomerIdentity,
  CustomerProfile,
} from '../../modules/customer/types/customer.types.js';
import type { Brand } from '../../shared/types/api.types.js';

import { createCustomersClient, type CustomersClient } from './clients/customers.client.js';
import { toCustomerProfile } from './mappers/customer.mapper.js';

export interface SfccProvider {
  getCustomer(identity: CustomerIdentity): Promise<CustomerProfile>;
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
      toCustomerProfile(await customers.getCustomer(accessToken, customerId)),
  };
}
