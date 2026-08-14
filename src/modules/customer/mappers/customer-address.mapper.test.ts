import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CustomerAddress as StoredAddress } from '../../../database/schemas/customer/index.js';
import { UnprocessableEntityError } from '../../../shared/errors/index.js';
import type { SfccAddressRecord } from '../types/customer.types.js';

import {
  requireSfccAddressId,
  toSfccAddressCreate,
  toSfccAddressUpdate,
  toSfccPreferredUpdate,
  toUpsertAddressInput,
} from './customer-address.mapper.js';

const ADDRESS_ROW_ID = '9f8c1e02-4a3b-4c5d-8e6f-1a2b3c4d5e6f';

function stored(overrides: Partial<StoredAddress> = {}): StoredAddress {
  return {
    id: ADDRESS_ROW_ID,
    customerId: 'c0ffee00-0000-4000-8000-000000000001',
    brand: 'rens',
    sfccAddressId: 'Home',
    firstName: 'Ada',
    lastName: 'Lovelace',
    street1: '1 Rue Sainte-Catherine',
    street2: null,
    city: 'Montreal',
    stateCode: 'QC',
    postalCode: 'H2X1Y4',
    countryCode: 'CA',
    phone: '514-555-1111',
    phoneType: 'mobile',
    isPreferred: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe('toSfccAddressCreate', () => {
  it('maps label onto the SFCC address name and defaults nothing else', () => {
    const address = toSfccAddressCreate({
      label: 'Work',
      firstName: 'Ada',
      lastName: 'Lovelace',
      street1: '1 Rue Sainte-Catherine',
      city: 'Montreal',
      stateCode: 'QC',
      postalCode: 'H2X1Y4',
      countryCode: 'CA',
      phone: '514-555-1111',
    });

    assert.equal(address.addressId, 'Work');
    // Untouched keys stay absent rather than arriving as undefined.
    assert.equal('street2' in address, false);
    assert.equal('phoneType' in address, false);
  });

  it('carries the optional fields through when they are supplied', () => {
    const address = toSfccAddressCreate({
      label: 'Home',
      firstName: 'Ada',
      lastName: 'Lovelace',
      street1: '1 Rue Sainte-Catherine',
      street2: 'Apartment 49',
      city: 'Montreal',
      stateCode: 'QC',
      postalCode: 'H2X1Y4',
      countryCode: 'CA',
      phone: '514-555-1111',
      phoneType: 'home',
    });

    assert.equal(address.street2, 'Apartment 49');
    assert.equal(address.phoneType, 'home');
  });
});

describe('toSfccAddressUpdate — the three fields SFCC insists on', () => {
  it('fills all three from the stored row when the patch omits them', () => {
    const update = toSfccAddressUpdate({ city: 'Laval' }, stored());

    assert.equal(update.addressId, 'Home');
    assert.equal(update.countryCode, 'CA');
    assert.equal(update.lastName, 'Lovelace');
    assert.equal(update.city, 'Laval');
  });

  it('lets a client-supplied value win over the stored one', () => {
    const update = toSfccAddressUpdate({ countryCode: 'US', lastName: 'Byron' }, stored());

    assert.equal(update.countryCode, 'US');
    assert.equal(update.lastName, 'Byron');
  });

  it('renames through label, which is what moves the SFCC address name', () => {
    const update = toSfccAddressUpdate({ label: 'Chalet' }, stored());

    // Differs from the stored name, which is what SFCC reads as a rename.
    assert.equal(update.addressId, 'Chalet');
  });

  it('rejects a row stored without the fields SFCC requires', () => {
    for (const missing of ['sfccAddressId', 'countryCode', 'lastName'] as const) {
      assert.throws(
        () => toSfccAddressUpdate({ city: 'Laval' }, stored({ [missing]: null })),
        UnprocessableEntityError,
        `a null ${missing} must not be papered over`,
      );
    }
  });

  it('never substitutes an empty string for a missing required field', () => {
    // The whole point of the 422: '' would satisfy SFCC and bury the problem.
    assert.throws(
      () => toSfccAddressUpdate({}, stored({ countryCode: '' })),
      UnprocessableEntityError,
    );
  });
});

describe('toSfccAddressUpdate — three-state on everything else', () => {
  it('omits what the patch did not mention', () => {
    const update = toSfccAddressUpdate({ city: 'Laval' }, stored());

    for (const untouched of [
      'firstName',
      'street1',
      'street2',
      'stateCode',
      'postalCode',
      'phone',
    ]) {
      assert.equal(untouched in update, false, `${untouched} must stay absent`);
    }
  });

  it('keeps an explicit null so it can clear', () => {
    const update = toSfccAddressUpdate({ street2: null, phoneType: null }, stored());

    assert.equal('street2' in update, true);
    assert.equal(update.street2, null);
    assert.equal(update.phoneType, null);
  });

  it('never sets preferred — that is what the dedicated mapper is for', () => {
    assert.equal('preferred' in toSfccAddressUpdate({ city: 'Laval' }, stored()), false);
  });
});

describe('toSfccPreferredUpdate', () => {
  it('sends preferred plus exactly the three required fields', () => {
    const update = toSfccPreferredUpdate(stored());

    assert.deepEqual(update, {
      addressId: 'Home',
      countryCode: 'CA',
      lastName: 'Lovelace',
      preferred: true,
    });
  });

  it('rejects an incompletely stored row the same way a patch does', () => {
    assert.throws(
      () => toSfccPreferredUpdate(stored({ sfccAddressId: null })),
      UnprocessableEntityError,
    );
  });
});

describe('toUpsertAddressInput', () => {
  const record: SfccAddressRecord = {
    addressId: 'Home',
    firstName: 'Ada',
    lastName: 'Lovelace',
    address1: '1 Rue Sainte-Catherine',
    address2: 'Apartment 49',
    city: 'Montreal',
    stateCode: 'QC',
    postalCode: 'H2X 1Y4',
    countryCode: 'CA',
    phone: '514-555-1111',
    phoneType: 'mobile',
  };

  it('renames the SFCC address fields onto the stored column names', () => {
    const input = toUpsertAddressInput(record);

    assert.equal(input.street1, '1 Rue Sainte-Catherine');
    assert.equal(input.street2, 'Apartment 49');
    assert.equal(input.sfccAddressId, 'Home');
    // Raw — normalizePostalCode runs at the repository boundary.
    assert.equal(input.postalCode, 'H2X 1Y4');
  });

  it('carries the row id so a rename updates rather than inserts', () => {
    assert.equal(toUpsertAddressInput(record, stored()).id, ADDRESS_ROW_ID);
    // No stored row on a create, so the upsert has to insert.
    assert.equal(toUpsertAddressInput(record).id, undefined);
  });

  it('falls back to the stored preferred flag when SFCC omits it', () => {
    // Without this an untouched preferred address would be demoted by its own
    // patch, because the upsert defaults a missing flag to false.
    assert.equal(toUpsertAddressInput(record, stored({ isPreferred: true })).isPreferred, true);
  });

  it('takes SFCC over the stored flag when SFCC states it', () => {
    assert.equal(
      toUpsertAddressInput({ ...record, preferred: false }, stored({ isPreferred: true }))
        .isPreferred,
      false,
    );
  });

  it('defaults to not preferred on a create', () => {
    assert.equal(toUpsertAddressInput(record).isPreferred, false);
  });

  it('nulls a field SFCC did not report rather than leaving it undefined', () => {
    // The address write is a full replacement, so `undefined` and `null` would
    // reach the row identically — being explicit keeps that visible.
    const input = toUpsertAddressInput({ addressId: 'Sparse' });

    assert.equal(input.street1, null);
    assert.equal(input.city, null);
    assert.equal(input.phoneType, null);
  });
});

describe('requireSfccAddressId', () => {
  it('returns the stored name', () => {
    assert.equal(requireSfccAddressId(stored()), 'Home');
  });

  it('is a 422, because a row SFCC never named cannot be addressed upstream', () => {
    assert.throws(
      () => requireSfccAddressId(stored({ sfccAddressId: null })),
      (error: unknown) => {
        assert.ok(error instanceof UnprocessableEntityError);
        assert.equal(error.statusCode, 422);

        return true;
      },
    );
  });
});
