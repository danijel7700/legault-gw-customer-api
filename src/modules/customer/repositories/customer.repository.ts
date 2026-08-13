import type {
  Brand,
  Customer,
  CustomerAddress,
  ExternalSystem,
} from '../../../database/schemas/customer/index.js';
import { NotFoundError } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/logger/logger.js';

import {
  clearPreferredAddress,
  deleteAddressRow,
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

/**
 * The only layer that touches the database.
 *
 * This file owns the aggregate: transactions, resolution order and the public
 * contract. The per-table SQL lives in the sibling `*.queries.ts` modules, which
 * are internal — `customer_external_id` and `customer_address` have no
 * independent life and are always read and written through a customer.
 *
 * Takes its `db` rather than importing the singleton, so a test can hand it a
 * connection to a scratch database. The same parameter type accepts a
 * transaction handle, which is how the helpers below compose.
 */
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
      // Normalizing first is what stops a placeholder address matching anything.
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

    async upsertAddress(customerId: string, input: UpsertAddressInput): Promise<CustomerAddress> {
      return db.transaction(async (tx) => {
        const brand = await requireCustomerBrand(tx, customerId);
        const address = await upsertAddressRow(tx, customerId, brand, input);

        await bumpCustomerVersion(tx, customerId);

        return address;
      });
    },

    /**
     * Idempotent: deleting an address that is already gone is not an error and
     * does not bump the version.
     *
     * If the deleted row was the preferred one, the customer is left with no
     * preferred address. Promoting another is a service decision, so nothing is
     * promoted here — and because the signature returns nothing, a caller that
     * needs to know must re-read `listAddresses`.
     */
    async deleteAddress(customerId: string, addressId: string): Promise<void> {
      await db.transaction(async (tx) => {
        if (await deleteAddressRow(tx, customerId, addressId)) {
          await bumpCustomerVersion(tx, customerId);
        }
      });
    },

    /**
     * Clearing the old row and setting the new one must happen together:
     * `customer_address_preferred_uq` is a partial unique index, so two
     * statements outside a transaction, or in the wrong order, collide.
     */
    async setPreferredAddress(customerId: string, addressId: string): Promise<void> {
      await db.transaction(async (tx) => {
        await clearPreferredAddress(tx, customerId, addressId);

        if (!(await setPreferredFlag(tx, customerId, addressId))) {
          throw new NotFoundError('Address not found');
        }

        await bumpCustomerVersion(tx, customerId);
      });
    },
  };
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
    // A nested transaction is a SAVEPOINT. Without it a unique violation would
    // abort the whole outer transaction and the re-resolve below could not run.
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

    // Another transaction created this customer between our resolve and our
    // insert. It has committed by now — the insert only raised 23505 once it
    // did — so a single re-resolve finds it. No retry loop.
    logger.info({ constraint }, 'Concurrent customer insert — re-resolving');

    const racedId = await resolveCustomerId(tx, input);

    if (racedId === undefined) {
      throw error;
    }

    return { customer: await applyUpsert(tx, racedId, input), created: false };
  }
}

/**
 * External ids first, then email — the documented resolution order.
 *
 * Step 2 is what stops a customer that arrived from another source, with no
 * SFCC id yet, from being duplicated.
 */
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
