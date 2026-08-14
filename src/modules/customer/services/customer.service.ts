import type { BrandConfig } from '../../../config/types/brand.types.js';
import { db } from '../../../database/index.js';
import {
  EXTERNAL_ID_TYPES,
  type Customer,
  type CustomerAddress as StoredAddress,
} from '../../../database/schemas/customer/index.js';
import { getSfccProvider } from '../../../providers/sfcc/index.js';
import { isHttpError, NotFoundError } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/logger/logger.js';
import {
  requireSfccAddressId,
  toSfccAddressCreate,
  toSfccAddressUpdate,
  toSfccPreferredUpdate,
  toUpsertAddressInput,
} from '../mappers/customer-address.mapper.js';
import { toCustomerProfile, toResponseAddress } from '../mappers/customer-profile.mapper.js';
import { toSfccCustomerUpdate, toUpdateProfileInput } from '../mappers/customer-update.mapper.js';
import {
  toCustomerProfile as toCustomerProfileFromRecord,
  toResponseAddress as toResponseAddressFromRecord,
  toUpsertInput,
} from '../mappers/sfcc-customer.mapper.js';
import { createCustomerRepository } from '../repositories/customer.repository.js';
import type {
  CustomerRepository,
  UpdateProfileOptions,
} from '../repositories/types/customer.repository.types.js';
import type {
  CreateMemberAddressRequest,
  CustomerAddress,
  CustomerIdentity,
  CustomerProfile,
  UpdateMemberAddressRequest,
  UpdateMemberProfileRequest,
} from '../types/customer.types.js';
import { uniqueViolationConstraint } from '../repositories/utils/pg-error.util.js';

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

async function resolveStoredCustomer(
  brandConfig: BrandConfig,
  identity: CustomerIdentity,
): Promise<Customer> {
  const repo = getCustomerRepository();

  const stored = await repo.findByExternalId(
    brandConfig.brand,
    'SFCC',
    EXTERNAL_ID_TYPES.SFCC.CUSTOMER_ID,
    identity.customerId,
  );

  if (stored !== null) {
    return stored;
  }

  const record = await getSfccProvider(brandConfig).getCustomer(identity);
  const { customer } = await repo.upsertFromSfcc(
    toUpsertInput(brandConfig.brand, identity.customerId, record),
  );

  return customer;
}

function requireAddress(customer: Customer, addressId: string): StoredAddress {
  const address = customer.addresses.find((candidate) => candidate.id === addressId);

  if (address === undefined) {
    throw new NotFoundError('Address not found');
  }

  return address;
}

function logAddressWriteFailure(
  error: unknown,
  context: { customerId: string; brand: string; addressId?: string },
): void {
  const safe = isHttpError(error)
    ? { err: error }
    : {
        errorName: error instanceof Error ? error.name : typeof error,
        pgCode: uniqueViolationConstraint(error),
      };

  logger.error(
    { ...context, ...safe },
    'SFCC accepted the address write but it could not be stored — the two now disagree',
  );
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

export async function createAddress(
  brandConfig: BrandConfig,
  identity: CustomerIdentity,
  request: CreateMemberAddressRequest,
): Promise<CustomerAddress> {
  const repo = getCustomerRepository();
  const customer = await resolveStoredCustomer(brandConfig, identity);

  const record = await getSfccProvider(brandConfig).createAddress(
    identity,
    toSfccAddressCreate(request),
  );

  try {
    return toResponseAddress(await repo.upsertAddress(customer.id, toUpsertAddressInput(record)));
  } catch (error) {
    logAddressWriteFailure(error, {
      customerId: identity.customerId,
      brand: brandConfig.brand,
    });

    return toResponseAddressFromRecord(record);
  }
}

export async function updateAddress(
  brandConfig: BrandConfig,
  identity: CustomerIdentity,
  addressId: string,
  request: UpdateMemberAddressRequest,
): Promise<CustomerAddress> {
  const repo = getCustomerRepository();
  const customer = await resolveStoredCustomer(brandConfig, identity);
  const stored = requireAddress(customer, addressId);

  const record = await getSfccProvider(brandConfig).updateAddress(
    identity,
    requireSfccAddressId(stored),
    toSfccAddressUpdate(request, stored),
  );

  try {
    return toResponseAddress(
      await repo.upsertAddress(customer.id, toUpsertAddressInput(record, stored)),
    );
  } catch (error) {
    logAddressWriteFailure(error, {
      customerId: identity.customerId,
      brand: brandConfig.brand,
      addressId,
    });

    return toResponseAddressFromRecord(record, stored.id);
  }
}

export async function deleteAddress(
  brandConfig: BrandConfig,
  identity: CustomerIdentity,
  addressId: string,
): Promise<void> {
  const repo = getCustomerRepository();
  const customer = await resolveStoredCustomer(brandConfig, identity);
  const stored = requireAddress(customer, addressId);

  await getSfccProvider(brandConfig).deleteAddress(identity, requireSfccAddressId(stored));

  try {
    await repo.deleteAddress(customer.id, addressId);
  } catch (error) {
    logAddressWriteFailure(error, {
      customerId: identity.customerId,
      brand: brandConfig.brand,
      addressId,
    });
  }
}

export async function setPreferredAddress(
  brandConfig: BrandConfig,
  identity: CustomerIdentity,
  addressId: string,
): Promise<CustomerAddress> {
  const repo = getCustomerRepository();
  const customer = await resolveStoredCustomer(brandConfig, identity);
  const stored = requireAddress(customer, addressId);

  await getSfccProvider(brandConfig).updateAddress(
    identity,
    requireSfccAddressId(stored),
    toSfccPreferredUpdate(stored),
  );

  try {
    return toResponseAddress(await repo.setPreferredAddress(customer.id, addressId));
  } catch (error) {
    logAddressWriteFailure(error, {
      customerId: identity.customerId,
      brand: brandConfig.brand,
      addressId,
    });

    return toResponseAddress({ ...stored, isPreferred: true });
  }
}
