import type { BrandConfig } from '../../../config/types/brand.types.js';
import { getSfccProvider } from '../../../providers/sfcc/index.js';
import type { CustomerIdentity, CustomerProfile } from '../types/customer.types.js';

export function getCustomer(
  brandConfig: BrandConfig,
  identity: CustomerIdentity,
): Promise<CustomerProfile> {
  return getSfccProvider(brandConfig).getCustomer(identity);
}
