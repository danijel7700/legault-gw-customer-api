import type {
  Brand,
  Customer,
  CustomerAddress,
  ExternalSystem,
  SourceSystem,
} from '../../../database/schemas/customer/index.js';
import { NotFoundError } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/logger/logger.js';

import {
  clearPreferredAddress,
  deleteAddressRow,
  findOldestAddressId,
  insertAddress,
  listAddressRows,
  setPreferredFlag,
  upsertAddressRow,
} from './customer-address.queries.js';
import {
  findCustomerIdByAnyExternalId,
  findCustomerIdByExternalId,
  insertExternalIds,
  linkExternalIds,
} from './customer-external-id.queries.js';
import {
  applyCustomerUpdate,
  bumpCustomerVersion,
  buildProfilePatch,
  buildUpsertProfileSet,
  findAggregate,
  findCustomerIdByEmail,
  insertCustomerRow,
  requireAggregate,
  requireCustomerBrand,
  stampWrite,
  throwUpdateFailure,
} from './customer.queries.js';
import type {
  CreateCustomerInput,
  CustomerRepository,
  Db,
  UpdateProfileInput,
  UpdateProfileOptions,
  UpsertAddressInput,
  UpsertFromSfccInput,
  UpsertFromSfccResult,
} from './types/customer.repository.types.js';
import { uniqueViolationConstraint } from './utils/pg-error.util.js';

export function createCustomerRepository(db: Db): CustomerRepository {
  return {
    async findById(id: string): Promise<Customer | null> {
      return findAggregate(db, id);
    },

    async findByExternalId(
      brand: Brand,
      system: ExternalSystem,
      idType: string,
      value: string,
    ): Promise<Customer | null> {
      const customerId = await findCustomerIdByExternalId(db, brand, system, idType, value);

      return customerId === undefined ? null : findAggregate(db, customerId);
    },

    async findByEmail(brand: Brand, email: string): Promise<Customer | null> {
      const customerId = await findCustomerIdByEmail(db, brand, email);

      return customerId === undefined ? null : findAggregate(db, customerId);
    },

    async create(input: CreateCustomerInput): Promise<Customer> {
      return db.transaction(async (tx) => insertAggregate(tx, input));
    },

    async updateProfile(
      id: string,
      patch: UpdateProfileInput,
      opts: UpdateProfileOptions,
    ): Promise<Customer> {
      return db.transaction(async (tx) => {
        const set = stampWrite(buildProfilePatch(patch), opts.modifiedBy);
        const matched = await applyCustomerUpdate(tx, id, set, opts.expectedVersion);

        if (!matched) {
          await throwUpdateFailure(tx, id, opts.expectedVersion);
        }

        return requireAggregate(tx, id);
      });
    },

    async upsertFromSfcc(input: UpsertFromSfccInput): Promise<UpsertFromSfccResult> {
      return db.transaction(async (tx) => upsertWithin(tx, input));
    },

    async listAddresses(customerId: string): Promise<CustomerAddress[]> {
      return listAddressRows(db, customerId);
    },

    async upsertAddress(
      customerId: string,
      input: UpsertAddressInput,
      modifiedBy: SourceSystem = 'CORE_API',
    ): Promise<CustomerAddress> {
      return db.transaction(async (tx) => {
        const brand = await requireCustomerBrand(tx, customerId);
        const address = await upsertAddressRow(tx, customerId, brand, input);

        await bumpCustomerVersion(tx, customerId, modifiedBy);

        return address;
      });
    },

    async deleteAddress(
      customerId: string,
      addressId: string,
      modifiedBy: SourceSystem = 'CORE_API',
    ): Promise<CustomerAddress | undefined> {
      return db.transaction(async (tx) => {
        const deleted = await deleteAddressRow(tx, customerId, addressId);

        if (deleted === undefined) {
          return undefined;
        }

        const promoted = deleted.isPreferred
          ? await promoteOldestAddress(tx, customerId)
          : undefined;

        await bumpCustomerVersion(tx, customerId, modifiedBy);

        return promoted;
      });
    },

    async setPreferredAddress(
      customerId: string,
      addressId: string,
      modifiedBy: SourceSystem = 'CORE_API',
    ): Promise<CustomerAddress> {
      return db.transaction(async (tx) => {
        await clearPreferredAddress(tx, customerId, addressId);

        const address = await setPreferredFlag(tx, customerId, addressId);

        if (address === undefined) {
          throw new NotFoundError('Address not found');
        }

        await bumpCustomerVersion(tx, customerId, modifiedBy);

        return address;
      });
    },
  };
}

async function promoteOldestAddress(
  tx: Db,
  customerId: string,
): Promise<CustomerAddress | undefined> {
  const oldestId = await findOldestAddressId(tx, customerId);

  return oldestId === undefined ? undefined : setPreferredFlag(tx, customerId, oldestId);
}

async function insertAggregate(tx: Db, input: CreateCustomerInput): Promise<Customer> {
  const customerId = await insertCustomerRow(tx, input.brand, input.profile, input.source);

  await insertExternalIds(tx, customerId, input.brand, input.externalIds);

  for (const address of input.addresses) {
    await insertAddress(tx, customerId, input.brand, address);
  }

  return requireAggregate(tx, customerId);
}

async function upsertWithin(tx: Db, input: UpsertFromSfccInput): Promise<UpsertFromSfccResult> {
  const resolvedId = await resolveCustomerId(tx, input);

  if (resolvedId !== undefined) {
    return { customer: await applyUpsert(tx, resolvedId, input), created: false };
  }

  try {
    const created = await tx.transaction(async (savepoint) =>
      insertAggregate(savepoint, {
        brand: input.brand,
        profile: input.profile,
        source: input.source,
        externalIds: input.externalIds,
        addresses: input.addresses,
      }),
    );

    return { customer: created, created: true };
  } catch (error) {
    const constraint = uniqueViolationConstraint(error);

    if (constraint === undefined) {
      throw error;
    }

    logger.info({ constraint }, 'Concurrent customer insert — re-resolving');

    const racedId = await resolveCustomerId(tx, input);

    if (racedId === undefined) {
      throw error;
    }

    return { customer: await applyUpsert(tx, racedId, input), created: false };
  }
}

async function resolveCustomerId(tx: Db, input: UpsertFromSfccInput): Promise<string | undefined> {
  const byExternalId = await findCustomerIdByAnyExternalId(tx, input.brand, input.externalIds);

  if (byExternalId !== undefined) {
    return byExternalId;
  }

  return findCustomerIdByEmail(tx, input.brand, input.profile.email);
}

async function applyUpsert(
  tx: Db,
  customerId: string,
  input: UpsertFromSfccInput,
): Promise<Customer> {
  await linkExternalIds(tx, customerId, input.brand, input.externalIds);

  const set = stampWrite(buildUpsertProfileSet(input.profile), input.source);

  await applyCustomerUpdate(tx, customerId, set, undefined);

  for (const address of input.addresses) {
    await upsertAddressRow(tx, customerId, input.brand, address);
  }

  return requireAggregate(tx, customerId);
}
