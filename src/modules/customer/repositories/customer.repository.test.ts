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
import { uniqueViolationConstraint } from './utils/pg-error.util.js';
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
async function countRows(
  table: 'customer' | 'customer_external_id' | 'customer_address',
): Promise<number> {
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

  it('stores a customer with no lastName', async () => {
    const created = await repo.create(
      createInput({ profile: { email: 'noname@example.com' }, externalIds: [] }),
    );

    assert.equal(created.profile.lastName, null);
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

  it('normalizes an account-level postal code the way the address path does', async () => {
    const created = await repo.create(createInput());

    const updated = await repo.updateProfile(
      created.id,
      { postalCode: 'h2x 1y4' },
      { modifiedBy: 'CORE_API' },
    );

    // Callers send whatever they were shown; the store keeps one form so two
    // spellings of the same code are one value.
    assert.equal(updated.profile.postalCode, 'H2X1Y4');
  });

  it('clears postalCode and preferredStore with null', async () => {
    const created = await repo.create(
      createInput({
        profile: { lastName: 'Lovelace', postalCode: 'H2X1Y4', preferredStore: '2078' },
      }),
    );

    const updated = await repo.updateProfile(
      created.id,
      { postalCode: null, preferredStore: null },
      { modifiedBy: 'CORE_API' },
    );

    assert.equal(updated.profile.postalCode, null);
    assert.equal(updated.profile.preferredStore, null);
  });

  it('is the only way to clear a field an SFCC upsert would have preserved', async () => {
    // Why the update path exists alongside upsertFromSfcc: a customer known
    // under another key resolves to an existing row, and the upsert overwrites
    // but never clears. Every field a PATCH asked to clear would keep its old
    // value if the upsert were the last word.
    const created = await repo.create(
      createInput({
        source: 'MOBILE_APP',
        profile: { email: 'ada.lovelace@example.com', phoneMobile: '514-555-1111' },
        externalIds: [],
      }),
    );

    const { customer, created: inserted } = await repo.upsertFromSfcc(
      upsertInput({ profile: { email: 'ada.lovelace@example.com', lastName: 'Lovelace' } }),
    );

    assert.equal(inserted, false);
    assert.equal(customer.id, created.id);
    assert.equal(customer.profile.phoneMobile, '514-555-1111');

    const updated = await repo.updateProfile(
      customer.id,
      { phoneMobile: null },
      { modifiedBy: 'CORE_API' },
    );

    assert.equal(updated.profile.phoneMobile, null);
    assert.equal(updated.metadata.source, 'MOBILE_APP');
    assert.equal(updated.metadata.lastModifiedBy, 'CORE_API');
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

  it('does not clobber a stored lastName when the payload omits it', async () => {
    const created = await repo.create(createInput());

    const result = await repo.upsertFromSfcc(
      upsertInput({ profile: { email: 'ada.lovelace@example.com', firstName: 'Augusta' } }),
    );

    assert.equal(result.customer.id, created.id);
    assert.equal(result.customer.profile.firstName, 'Augusta');
    assert.equal(result.customer.profile.lastName, 'Lovelace', 'absent lastName leaves it alone');
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

    const promoted = await repo.setPreferredAddress(created.id, work.id);

    // Returned rather than read back: the swap already fetched the row.
    assert.equal(promoted.id, work.id);
    assert.equal(promoted.isPreferred, true);

    const addresses = await repo.listAddresses(created.id);
    const preferred = addresses.filter((address) => address.isPreferred);

    assert.equal(preferred.length, 1, 'the partial unique index allows exactly one');
    assert.equal(preferred[0]?.id, work.id);
    assert.equal(addresses.find((address) => address.id === home.id)?.isPreferred, false);
  });

  it('upsertAddress renames a row when it is given our id, instead of inserting', async () => {
    const created = await repo.create(createInput());
    const home = await repo.upsertAddress(created.id, {
      sfccAddressId: 'Home',
      street1: '1 Rue Sainte-Catherine',
    });

    // What a rename looks like coming back from SFCC: our id, the new name.
    const renamed = await repo.upsertAddress(created.id, {
      id: home.id,
      sfccAddressId: 'Chalet',
      street1: '1 Rue Sainte-Catherine',
    });

    assert.equal(renamed.id, home.id, 'the same row, renamed');
    assert.equal(renamed.sfccAddressId, 'Chalet');
    assert.equal(await countRows('customer_address'), 1, 'no duplicate row');
  });

  it('upsertAddress does not overwrite a sibling that already holds the new name', async () => {
    const created = await repo.create(createInput());
    const home = await repo.upsertAddress(created.id, { sfccAddressId: 'Home' });
    await repo.upsertAddress(created.id, { sfccAddressId: 'Work', street1: 'Keep me' });

    // Matching by name here would find Work and silently overwrite it, losing a
    // row the caller never mentioned. The unique index is the backstop, and the
    // constraint is asserted so this cannot start passing for another reason.
    await assert.rejects(
      () => repo.upsertAddress(created.id, { id: home.id, sfccAddressId: 'Work' }),
      (error: unknown) => {
        assert.equal(uniqueViolationConstraint(error), 'customer_address_sfcc_id_uq');

        return true;
      },
    );

    const addresses = await repo.listAddresses(created.id);

    assert.equal(addresses.length, 2);
    assert.equal(addresses.find((a) => a.sfccAddressId === 'Work')?.street1, 'Keep me');
  });

  it('still matches on sfccAddressId when the SFCC sync path supplies no id', async () => {
    const created = await repo.create(createInput());
    const first = await repo.upsertAddress(created.id, { sfccAddressId: 'Home', city: 'Montreal' });
    const second = await repo.upsertAddress(created.id, { sfccAddressId: 'Home', city: 'Laval' });

    assert.equal(second.id, first.id);
    assert.equal(await countRows('customer_address'), 1);
  });

  it('address writes stamp lastModifiedBy on the parent', async () => {
    const created = await repo.create(createInput());

    assert.equal(created.metadata.lastModifiedBy, 'SFCC');

    const address = await repo.upsertAddress(created.id, { sfccAddressId: 'Home' });

    assert.equal((await repo.findById(created.id))?.metadata.lastModifiedBy, 'CORE_API');

    await repo.setPreferredAddress(created.id, address.id);
    assert.equal((await repo.findById(created.id))?.metadata.lastModifiedBy, 'CORE_API');

    // The origin is never rewritten by a later write.
    assert.equal((await repo.findById(created.id))?.metadata.source, 'SFCC');
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

  it('deleting the preferred address promotes the oldest one left', async () => {
    const created = await repo.create(createInput());
    // Separate calls are separate transactions, so created_at really differs —
    // the ordering under test is real, not incidental.
    const work = await repo.upsertAddress(created.id, { sfccAddressId: 'Work' });
    await repo.upsertAddress(created.id, { sfccAddressId: 'Chalet' });
    const home = await repo.upsertAddress(created.id, { sfccAddressId: 'Home', isPreferred: true });

    const promoted = await repo.deleteAddress(created.id, home.id);

    assert.ok(promoted, 'the delete chose a replacement');
    assert.equal(promoted.id, work.id, 'the longest-held remaining address');
    assert.equal(promoted.isPreferred, true);

    const preferred = (await repo.listAddresses(created.id)).filter((a) => a.isPreferred);
    assert.equal(preferred.length, 1);
    assert.equal(preferred[0]?.id, work.id);
  });

  it('promotes the survivor when the preferred address was one of two', async () => {
    const created = await repo.create(createInput());
    const work = await repo.upsertAddress(created.id, { sfccAddressId: 'Work' });
    const home = await repo.upsertAddress(created.id, { sfccAddressId: 'Home', isPreferred: true });

    assert.equal((await repo.deleteAddress(created.id, home.id))?.id, work.id);

    const addresses = await repo.listAddresses(created.id);
    assert.equal(addresses.length, 1);
    assert.equal(addresses[0]?.isPreferred, true);
  });

  it('promotes nothing when the deleted address was not the preferred one', async () => {
    const created = await repo.create(createInput());
    const home = await repo.upsertAddress(created.id, { sfccAddressId: 'Home', isPreferred: true });
    const work = await repo.upsertAddress(created.id, { sfccAddressId: 'Work' });

    assert.equal(await repo.deleteAddress(created.id, work.id), undefined);

    // The existing preferred address is left exactly where it was.
    const addresses = await repo.listAddresses(created.id);
    const [remaining] = addresses;

    assert.equal(addresses.length, 1);
    assert.ok(remaining);
    assert.equal(remaining.id, home.id);
    assert.equal(remaining.isPreferred, true);
  });

  it('promotes nothing when the preferred address was the last one', async () => {
    const created = await repo.create(createInput());
    const home = await repo.upsertAddress(created.id, { sfccAddressId: 'Home', isPreferred: true });

    assert.equal(await repo.deleteAddress(created.id, home.id), undefined);
    assert.equal((await repo.listAddresses(created.id)).length, 0);
  });

  it('bumps the version once on a delete that promoted, not twice', async () => {
    const created = await repo.create(createInput());
    await repo.upsertAddress(created.id, { sfccAddressId: 'Work' });
    const home = await repo.upsertAddress(created.id, { sfccAddressId: 'Home', isPreferred: true });

    const before = await repo.findById(created.id);
    assert.ok(before);

    await repo.deleteAddress(created.id, home.id);

    const after = await repo.findById(created.id);
    assert.ok(after);
    // A delete is one change to the customer, however many rows it touched.
    assert.equal(after.metadata.version, before.metadata.version + 1);
  });

  it('still promotes exactly one when every address shares a created_at', async () => {
    // `now()` is the transaction timestamp, so addresses written by one create
    // all tie. Which uuid wins is arbitrary — that exactly one does is not.
    const created = await repo.create(
      createInput({
        addresses: [
          { sfccAddressId: 'Home', isPreferred: true },
          { sfccAddressId: 'Work' },
          { sfccAddressId: 'Chalet' },
        ],
      }),
    );
    const home = created.addresses.find((a) => a.isPreferred);
    assert.ok(home);

    const promoted = await repo.deleteAddress(created.id, home.id);
    assert.ok(promoted, 'a replacement is chosen even when created_at cannot break the tie');

    const preferred = (await repo.listAddresses(created.id)).filter((a) => a.isPreferred);
    assert.equal(preferred.length, 1);
    assert.equal(preferred[0]?.id, promoted.id);
  });

  it('deleting an absent address is a no-op that does not bump the version', async () => {
    const created = await repo.create(createInput());

    await repo.deleteAddress(created.id, MISSING_ID);

    const after = await repo.findById(created.id);
    assert.ok(after);
    assert.equal(after.metadata.version, created.metadata.version);
  });
});
