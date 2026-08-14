import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CreateMemberAddressRequest } from '../types/customer.types.js';

import {
  addressParamsSchema,
  createAddressSchema,
  updateAddressSchema,
} from './customer-address.validation.js';

const VALID_UUID = '9f8c1e02-4a3b-4c5d-8e6f-1a2b3c4d5e6f';

const COMPLETE = {
  label: 'Home',
  firstName: 'Ada',
  lastName: 'Lovelace',
  street1: '1 Rue Sainte-Catherine',
  city: 'Montreal',
  stateCode: 'QC',
  postalCode: 'H2X1Y4',
  phone: '514-555-1111',
};

function created(body: unknown): CreateMemberAddressRequest {
  const result = createAddressSchema.safeParse(body);

  assert.ok(result.success, `expected ${JSON.stringify(body)} to be accepted`);

  return result.data;
}

describe('addressParamsSchema', () => {
  it('accepts our own row id', () => {
    assert.equal(addressParamsSchema.safeParse({ id: VALID_UUID }).success, true);
  });

  it('rejects anything that is not a uuid — including an SFCC address name', () => {
    // The route takes our id, not the SFCC one. Catching that here turns a
    // confused client into a 400 instead of an empty lookup.
    assert.equal(addressParamsSchema.safeParse({ id: 'Home' }).success, false);
    assert.equal(addressParamsSchema.safeParse({ id: '' }).success, false);
  });
});

describe('createAddressSchema', () => {
  it('defaults countryCode to CA', () => {
    assert.equal(created(COMPLETE).countryCode, 'CA');
  });

  it('upper-cases a supplied country code', () => {
    assert.equal(created({ ...COMPLETE, countryCode: 'us' }).countryCode, 'US');
  });

  it('rejects a country code that is not two letters', () => {
    assert.equal(createAddressSchema.safeParse({ ...COMPLETE, countryCode: 'CAN' }).success, false);
  });

  it('rejects a missing required field', () => {
    for (const field of Object.keys(COMPLETE)) {
      const { [field]: _dropped, ...partial } = COMPLETE as Record<string, unknown>;

      assert.equal(
        createAddressSchema.safeParse(partial).success,
        false,
        `${field} must be required`,
      );
    }
  });

  it('rejects a key it does not know', () => {
    // strictObject: on a write, silently dropping `preferred` would answer 201
    // having ignored what the caller asked for.
    assert.equal(createAddressSchema.safeParse({ ...COMPLETE, preferred: true }).success, false);
  });

  it('rejects blank and whitespace-only values', () => {
    assert.equal(createAddressSchema.safeParse({ ...COMPLETE, city: '   ' }).success, false);
    assert.equal(createAddressSchema.safeParse({ ...COMPLETE, label: '' }).success, false);
  });

  it('trims what it accepts', () => {
    assert.equal(created({ ...COMPLETE, city: '  Montreal  ' }).city, 'Montreal');
  });

  it('accepts a null street2 but not a null city', () => {
    assert.equal(createAddressSchema.safeParse({ ...COMPLETE, street2: null }).success, true);
    assert.equal(createAddressSchema.safeParse({ ...COMPLETE, city: null }).success, false);
  });
});

describe('updateAddressSchema', () => {
  it('accepts a single field', () => {
    assert.deepEqual(updateAddressSchema.parse({ city: 'Laval' }), { city: 'Laval' });
  });

  it('rejects an empty patch', () => {
    assert.equal(updateAddressSchema.safeParse({}).success, false);
  });

  it('rejects an unknown key', () => {
    assert.equal(updateAddressSchema.safeParse({ addressId: 'Home' }).success, false);
  });

  it('accepts null only where clearing leaves a deliverable address', () => {
    assert.equal(updateAddressSchema.safeParse({ street2: null }).success, true);
    assert.equal(updateAddressSchema.safeParse({ phoneType: null }).success, true);

    // Clearing these would leave an address nothing could be sent to.
    for (const structural of ['city', 'street1', 'postalCode', 'stateCode', 'label', 'phone']) {
      assert.equal(
        updateAddressSchema.safeParse({ [structural]: null }).success,
        false,
        `${structural} must not be clearable`,
      );
    }
  });

  it('rejects a phoneType outside the two the store has a column for', () => {
    assert.equal(updateAddressSchema.safeParse({ phoneType: 'work' }).success, false);
  });

  it('leaves absent fields absent rather than materialising them', () => {
    const patch = updateAddressSchema.parse({ label: 'Chalet' }) as Record<string, unknown>;

    assert.deepEqual(Object.keys(patch), ['label']);
  });
});
