import type { BrandConfig } from '../../config/types/brand.types.js';
import type {
  CustomerIdentity,
  SfccCustomerRecord,
} from '../../modules/customer/types/customer.types.js';
import type { Brand } from '../../shared/types/api.types.js';

import { createCustomersClient, type CustomersClient } from './clients/customers.client.js';
import { toSfccCustomerRecord } from './mappers/customer.mapper.js';

export interface SfccProvider {
  /**
   * Reports what SFCC holds. Shaping that into the API response is the
   * customer module's business, not this provider's.
   */
  getCustomer(identity: CustomerIdentity): Promise<SfccCustomerRecord>;
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
  };
}
