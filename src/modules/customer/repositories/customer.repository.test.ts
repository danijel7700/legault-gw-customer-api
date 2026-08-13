import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  createTestDatabase,
  truncateAll,
  type TestDatabase,
} from '../../../test-support/test-db.js';

import {
  CustomerNotFoundError,
  CustomerVersionConflictError,
  DuplicateExternalIdError,
} from '../errors/customer.error.js';

import { createCustomerRepository } from './customer.repository.js';
import type {
  CreateCustomerInput,
  CustomerRepository,
  UpsertFromSfccInput,
} from './types/customer.repository.types.js';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let testDb: TestDatabase;
let repo: CustomerRepository;

before(async () => {
  testDb = await createTestDatabase();
  repo = createCustomerRepository(testDb.db);
});

after(async () => {
  await testDb.close();
});

beforeEach(async () => {
  await truncateAll(testDb.pool);
});

/** Table name is a literal in every call site, never user input. */
async function countRows(table: 'customer' | 'customer_external_id'): Promise<number> {
  const result = await testDb.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);

  return result.rows[0]?.n ?? 0;
}

function createInput(overrides: Partial<CreateCustomerInput> = {}): CreateCustomerInput {
  return {
    brand: 'rens',
    source: 'SFCC',
    profile: { email: 'Ada.Lovelace@Example.com', firstName: 'Ada', lastName: 'Lovelace' },
    externalIds: [{ system: 'SFCC', idType: 'customerId', value: 'abc123' }],
    addresses: [],
    ...overrides,
  };
}

function upsertInput(overrides: Partial<UpsertFromSfccInput> = {}): UpsertFromSfccInput {
  return {
    brand: 'rens',
    source: 'SFCC',
    profile: { email: 'ada.lovelace@example.com', lastName: 'Lovelace' },
    externalIds: [{ system: 'SFCC', idType: 'customerId', value: 'abc123' }],
    addresses: [],
    ...overrides,
  };
}

describe('reads', () => {
  it('create returns the assembled aggregate and findById round-trips it', async () => {
    const created = await repo.create(
      createInput({
        addresses: [
          { sfccAddressId: 'Home', street1: '1 Rue Sainte-Catherine', isPreferred: true },
        ],
      }),
    );

    assert.equal(created.brand, 'rens');
    assert.equal(created.profile.lastName, 'Lovelace');
    // Normalized on the way in.
    assert.equal(created.profile.email, 'ada.lovelace@example.com');
    assert.equal(created.metadata.version, 1);
    assert.equal(created.metadata.lastModifiedBy, 'SFCC');
    assert.equal(created.externalIds.length, 1);
    assert.equal(created.addresses.length, 1);

    const found = await repo.findById(created.id);
    assert.ok(found);
    assert.deepEqual(found.id, created.id);
  });

  it('findById returns null for an unknown id', async () => {
    assert.equal(await repo.findById(MISSING_ID), null);
  });

  it('findByExternalId resolves the aggregate', async () => {
    const created = await repo.create(createInput());

    const found = await repo.findByExternalId('rens', 'SFCC', 'customerId', 'abc123');
    assert.ok(found);
    assert.equal(found.id, created.id);

    // Brand is part of the key — the same value under the other brand must miss.
    assert.equal(await repo.findByExternalId('mondou', 'SFCC', 'customerId', 'abc123'), null);
  });

  it('findByEmail normalizes the input and never matches a placeholder', async () => {
    const created = await repo.create(createInput());

    const found = await repo.findByEmail('rens', '  ADA.LOVELACE@example.com ');
    assert.ok(found);
    assert.equal(found.id, created.id);

    assert.equal(await repo.findByEmail('rens', 'rm169685-noname@rewards.com'), null);
  });

  it('stores a placeholder email as null', async () => {
    const created = await repo.create(
      createInput({
        profile: { email: 'rm169685-noname@rewards.com', lastName: 'Nav' },
        externalIds: [],
      }),
    );

    assert.equal(created.profile.email, null);
  });
});

describe('updateProfile patch semantics', () => {
  it('leaves absent keys untouched and clears keys sent as null', async () => {
    const created = await repo.create(
      createInput({
        profile: {
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          phoneMobile: '514-555-5555',
        },
      }),
    );

    const updated = await repo.updateProfile(
      created.id,
      { firstName: 'Augusta', phoneMobile: null },
      { modifiedBy: 'CORE_API' },
    );

    assert.equal(updated.profile.firstName, 'Augusta', 'value present -> set');
    assert.equal(updated.profile.phoneMobile, null, 'null present -> cleared');
    assert.equal(updated.profile.email, 'ada@example.com', 'key absent -> untouched');
    assert.equal(updated.profile.lastName, 'Lovelace', 'key absent -> untouched');
  });

  it('treats an explicit undefined as absent, not as a clear', async () => {
    const created = await repo.create(createInput());

    const updated = await repo.updateProfile(
      created.id,
      { firstName: undefined },
      { modifiedBy: 'CORE_API' },
    );

    assert.equal(updated.profile.firstName, 'Ada');
  });

  it('bumps version and records who wrote it', async () => {
    const created = await repo.create(createInput());

    const updated = await repo.updateProfile(
      created.id,
      { firstName: 'Augusta' },
      { modifiedBy: 'MOBILE_APP' },
    );

    assert.equal(updated.metadata.version, created.metadata.version + 1);
    assert.equal(updated.metadata.lastModifiedBy, 'MOBILE_APP');
    assert.equal(updated.metadata.source, 'SFCC', 'source records the origin, not the last write');
  });

  it('throws a version conflict when the expected version has moved', async () => {
    const created = await repo.create(createInput());
    await repo.updateProfile(created.id, { firstName: 'Augusta' }, { modifiedBy: 'CORE_API' });

    await assert.rejects(
      () =>
        repo.updateProfile(
          created.id,
          { firstName: 'Ada' },
          { modifiedBy: 'CORE_API', expectedVersion: 1 },
        ),
      (error: unknown) => {
        assert.ok(error instanceof CustomerVersionConflictError);
        assert.equal(error.statusCode, 412);
        assert.equal(error.expectedVersion, 1);
        assert.equal(error.actualVersion, 2);
        return true;
      },
    );
  });

  it('succeeds when the expected version matches', async () => {
    const created = await repo.create(createInput());

    const updated = await repo.updateProfile(
      created.id,
      { firstName: 'Augusta' },
      { modifiedBy: 'CORE_API', expectedVersion: 1 },
    );

    assert.equal(updated.metadata.version, 2);
  });

  it('never creates — an unknown id is a not-found, with or without a version', async () => {
    await assert.rejects(
      () => repo.updateProfile(MISSING_ID, { firstName: 'Ada' }, { modifiedBy: 'CORE_API' }),
      CustomerNotFoundError,
    );

    await assert.rejects(
      () =>
        repo.updateProfile(
          MISSING_ID,
          { firstName: 'Ada' },
          { modifiedBy: 'CORE_API', expectedVersion: 1 },
        ),
      CustomerNotFoundError,
    );
  });
});

describe('upsertFromSfcc resolution order', () => {
  it('branch 1: matches on an external id', async () => {
    const created = await repo.create(createInput());

    const result = await repo.upsertFromSfcc(
      upsertInput({ profile: { email: 'moved@example.com', lastName: 'Lovelace' } }),
    );

    assert.equal(result.created, false);
    assert.equal(result.customer.id, created.id);
    assert.equal(result.customer.profile.email, 'moved@example.com');
  });

  it('branch 2: falls back to email and links the new external id', async () => {
    // Arrived from another source, so it carries no SFCC id yet.
    const created = await repo.create(
      createInput({
        source: 'MOBILE_APP',
        externalIds: [],
        profile: { email: 'ada.lovelace@example.com', lastName: 'Lovelace' },
      }),
    );
    assert.equal(created.externalIds.length, 0);

    const result = await repo.upsertFromSfcc(upsertInput());

    assert.equal(result.created, false, 'must not duplicate the existing customer');
    assert.equal(result.customer.id, created.id);
    assert.equal(result.customer.externalIds.length, 1, 'the SFCC id is linked on');
    assert.equal(result.customer.externalIds[0]?.value, 'abc123');
  });

  it('branch 3: creates when nothing matches', async () => {
    const result = await repo.upsertFromSfcc(upsertInput());

    assert.equal(result.created, true);
    assert.equal(result.customer.metadata.version, 1);
  });

  it('does not fall back to email when the email is a placeholder', async () => {
    await repo.create(createInput({ externalIds: [], profile: { email: null, lastName: 'Nav' } }));

    const result = await repo.upsertFromSfcc(
      upsertInput({
        externalIds: [],
        profile: { email: 'rm1-noname@rewards.com', lastName: 'Nav' },
      }),
    );

    assert.equal(result.created, true, 'a placeholder must never be a matching key');
  });

  it('overwrites present fields and leaves absent ones alone', async () => {
    const created = await repo.create(
      createInput({
        profile: {
          email: 'ada.lovelace@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          preferredStore: 'liberty-village',
        },
      }),
    );

    const result = await repo.upsertFromSfcc(
      upsertInput({ profile: { lastName: 'King', firstName: 'Augusta' } }),
    );

    assert.equal(result.customer.profile.firstName, 'Augusta');
    assert.equal(result.customer.profile.lastName, 'King');
    assert.equal(
      result.customer.profile.preferredStore,
      'liberty-village',
      'absent field is not cleared',
    );
    assert.equal(result.customer.metadata.version, created.metadata.version + 1);
  });

  it('fails closed when the supplied ids point at two different customers', async () => {
    await repo.create(createInput());
    await repo.create(
      createInput({
        profile: { email: 'other@example.com', lastName: 'Other' },
        externalIds: [{ system: 'SFCC', idType: 'customerNo', value: '00013270' }],
      }),
    );

    // The payload claims both ids, and they belong to different customers. That
    // needs a merge, so whichever one resolution happens to pick, linking the
    // other has to refuse rather than silently pick a winner.
    await assert.rejects(
      () =>
        repo.upsertFromSfcc(
          upsertInput({
            profile: { email: 'other@example.com', lastName: 'Other' },
            externalIds: [
              { system: 'SFCC', idType: 'customerId', value: 'abc123' },
              { system: 'SFCC', idType: 'customerNo', value: '00013270' },
            ],
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof DuplicateExternalIdError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.system, 'SFCC');
        return true;
      },
    );

    // The whole upsert is one transaction, so nothing partial survives.
    assert.equal(await countRows('customer_external_id'), 2, 'no external id was relinked');
  });

  it('survives two concurrent first-time upserts: one creates, one re-resolves', async () => {
    const [first, second] = await Promise.all([
      repo.upsertFromSfcc(upsertInput()),
      repo.upsertFromSfcc(upsertInput()),
    ]);

    assert.ok(first);
    assert.ok(second);

    const createdFlags = [first.created, second.created].sort();
    assert.deepEqual(createdFlags, [false, true], 'exactly one insert wins');
    assert.equal(first.customer.id, second.customer.id, 'both return the same customer');

    assert.equal(await countRows('customer'), 1, 'no duplicate row');
  });
});

describe('addresses', () => {
  it('upsertAddress matches on sfccAddressId so a re-sync does not duplicate', async () => {
    const created = await repo.create(createInput());

    const first = await repo.upsertAddress(created.id, {
      sfccAddressId: 'Home',
      street1: '1 Rue Sainte-Catherine',
      postalCode: 'h2x 1y4',
    });
    // Stored uppercase without spaces.
    assert.equal(first.postalCode, 'H2X1Y4');

    const second = await repo.upsertAddress(created.id, {
      sfccAddressId: 'Home',
      street1: '2 Rue Sainte-Catherine',
    });

    assert.equal(second.id, first.id, 'same row, updated');
    assert.equal(second.street1, '2 Rue Sainte-Catherine');
    assert.equal((await repo.listAddresses(created.id)).length, 1);
  });

  it('setPreferredAddress swaps the flag inside one transaction', async () => {
    const created = await repo.create(createInput());
    const home = await repo.upsertAddress(created.id, { sfccAddressId: 'Home', isPreferred: true });
    const work = await repo.upsertAddress(created.id, { sfccAddressId: 'Work' });

    await repo.setPreferredAddress(created.id, work.id);

    const addresses = await repo.listAddresses(created.id);
    const preferred = addresses.filter((address) => address.isPreferred);

    assert.equal(preferred.length, 1, 'the partial unique index allows exactly one');
    assert.equal(preferred[0]?.id, work.id);
    assert.equal(addresses.find((address) => address.id === home.id)?.isPreferred, false);
  });

  it('upsertAddress can move the preferred flag onto a new row', async () => {
    const created = await repo.create(createInput());
    await repo.upsertAddress(created.id, { sfccAddressId: 'Home', isPreferred: true });
    await repo.upsertAddress(created.id, { sfccAddressId: 'Work', isPreferred: true });

    const preferred = (await repo.listAddresses(created.id)).filter(
      (address) => address.isPreferred,
    );

    assert.equal(preferred.length, 1);
    assert.equal(preferred[0]?.sfccAddressId, 'Work');
  });

  it('address writes bump the parent version', async () => {
    const created = await repo.create(createInput());

    await repo.upsertAddress(created.id, { sfccAddressId: 'Home' });

    const afterUpsert = await repo.findById(created.id);
    assert.ok(afterUpsert);
    assert.equal(afterUpsert.metadata.version, created.metadata.version + 1);
  });

  it('deleteAddress leaves no preferred address and does not promote another', async () => {
    const created = await repo.create(createInput());
    const home = await repo.upsertAddress(created.id, { sfccAddressId: 'Home', isPreferred: true });
    await repo.upsertAddress(created.id, { sfccAddressId: 'Work' });

    await repo.deleteAddress(created.id, home.id);

    const addresses = await repo.listAddresses(created.id);
    assert.equal(addresses.length, 1);
    assert.equal(addresses[0]?.isPreferred, false, 'nothing is auto-promoted');
  });

  it('deleting an absent address is a no-op that does not bump the version', async () => {
    const created = await repo.create(createInput());

    await repo.deleteAddress(created.id, MISSING_ID);

    const after = await repo.findById(created.id);
    assert.ok(after);
    assert.equal(after.metadata.version, created.metadata.version);
  });
});
