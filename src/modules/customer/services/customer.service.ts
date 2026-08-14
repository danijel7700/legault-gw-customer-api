import type { BrandConfig } from '../../../config/types/brand.types.js';
import { db } from '../../../database/index.js';
import { EXTERNAL_ID_TYPES } from '../../../database/schemas/customer/index.js';
import { getSfccProvider } from '../../../providers/sfcc/index.js';
import { logger } from '../../../shared/logger/logger.js';
import { toCustomerProfile } from '../mappers/customer-profile.mapper.js';
import { toSfccCustomerUpdate, toUpdateProfileInput } from '../mappers/customer-update.mapper.js';
import {
  toCustomerProfile as toCustomerProfileFromRecord,
  toUpsertInput,
} from '../mappers/sfcc-customer.mapper.js';
import { createCustomerRepository } from '../repositories/customer.repository.js';
import type {
  CustomerRepository,
  UpdateProfileOptions,
} from '../repositories/types/customer.repository.types.js';
import type {
  CustomerIdentity,
  CustomerProfile,
  UpdateMemberProfileRequest,
} from '../types/customer.types.js';

const WRITE_OPTIONS: UpdateProfileOptions = { modifiedBy: 'CORE_API' };

let repository: CustomerRepository | undefined;

function getCustomerRepository(): CustomerRepository {
  repository ??= createCustomerRepository(db);

  return repository;
}

export async function getCustomer(
  brandConfig: BrandConfig,
  identity: CustomerIdentity,
): Promise<CustomerProfile> {
  const repo = getCustomerRepository();

  const stored = await repo.findByExternalId(
    brandConfig.brand,
    'SFCC',
    EXTERNAL_ID_TYPES.SFCC.CUSTOMER_ID,
    identity.customerId,
  );

  if (stored !== null) {
    return toCustomerProfile(stored);
  }

  const record = await getSfccProvider(brandConfig).getCustomer(identity);

  const input = toUpsertInput(brandConfig.brand, identity.customerId, record);

  try {
    const { customer, created } = await repo.upsertFromSfcc(input);

    logger.info(
      { customerId: identity.customerId, brand: brandConfig.brand, created },
      'Customer resolved from SFCC',
    );

    return toCustomerProfile(customer);
  } catch (error) {
    logger.error(
      { err: error, customerId: identity.customerId, brand: brandConfig.brand },
      'Failed to provision customer from SFCC — serving the upstream profile',
    );

    return toCustomerProfileFromRecord(record);
  }
}

export async function updateProfile(
  brandConfig: BrandConfig,
  identity: CustomerIdentity,
  request: UpdateMemberProfileRequest,
): Promise<CustomerProfile> {
  const repo = getCustomerRepository();

  const record = await getSfccProvider(brandConfig).updateCustomer(
    identity,
    toSfccCustomerUpdate(request),
  );

  const patch = toUpdateProfileInput(request);

  const stored = await repo.findByExternalId(
    brandConfig.brand,
    'SFCC',
    EXTERNAL_ID_TYPES.SFCC.CUSTOMER_ID,
    identity.customerId,
  );

  try {
    if (stored !== null) {
      return toCustomerProfile(await repo.updateProfile(stored.id, patch, WRITE_OPTIONS));
    }

    const { customer, created } = await repo.upsertFromSfcc(
      toUpsertInput(brandConfig.brand, identity.customerId, record),
    );

    logger.info(
      { customerId: identity.customerId, brand: brandConfig.brand, created },
      'Customer profile updated at SFCC',
    );

    if (!created) {
      return toCustomerProfile(await repo.updateProfile(customer.id, patch, WRITE_OPTIONS));
    }

    return toCustomerProfile(customer);
  } catch (error) {
    logger.error(
      { err: error, customerId: identity.customerId, brand: brandConfig.brand },
      'SFCC accepted the profile update but it could not be stored — the two now disagree',
    );

    throw error;
  }
}
