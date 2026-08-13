import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeLanguage } from '../../../database/schemas/customer/index.js';
import type { SfccCustomerRecord } from '../types/customer.types.js';

import { toCustomerProfile, toUpsertInput } from './sfcc-customer.mapper.js';

const CUSTOMER_ID = 'abl0g0kXtGlHgRkbhKlqYYxrIX';

function record(overrides: Partial<SfccCustomerRecord> = {}): SfccCustomerRecord {
  return { customerId: CUSTOMER_ID, lastName: 'Lovelace', ...overrides };
}

describe('normalizeLanguage', () => {
  it('reduces a locale to a bare language', () => {
    assert.equal(normalizeLanguage('en-CA'), 'en');
    assert.equal(normalizeLanguage('fr-CA'), 'fr');
    assert.equal(normalizeLanguage('FR'), 'fr');
    assert.equal(normalizeLanguage('fr_CA'), 'fr');
  });

  it('returns null for anything the brands do not support', () => {
    assert.equal(normalizeLanguage('de-DE'), null);
    assert.equal(normalizeLanguage(''), null);
    assert.equal(normalizeLanguage(undefined), null);
    assert.equal(normalizeLanguage(null), null);
  });
});

describe('toUpsertInput external ids', () => {
  it('emits all four when SFCC supplies them', () => {
    const input = toUpsertInput(
      'mondou',
      CUSTOMER_ID,
      record({
        customerNo: 'DEV_MND_00114027',
        sfscAccountId: '001As00000ABCDEF',
        sfscPersonContactId: '003As00000ABCDEF',
      }),
    );

    assert.deepEqual(
      input.externalIds.map((external) => [external.system, external.idType, external.value]),
      [
        ['SFCC', 'customerId', CUSTOMER_ID],
        ['SFCC', 'customerNo', 'DEV_MND_00114027'],
        ['SFSC', 'accountId', '001As00000ABCDEF'],
        ['SFSC', 'personContactId', '003As00000ABCDEF'],
      ],
    );
  });

  it('emits only customerId when nothing else is supplied — the Rens case', () => {
    const input = toUpsertInput('rens', CUSTOMER_ID, record());

    const [only] = input.externalIds;
    assert.ok(only);

    assert.equal(input.externalIds.length, 1);
    assert.equal(only.idType, 'customerId');
    // Taken from the authenticated header, not from the payload.
    assert.equal(only.value, CUSTOMER_ID);
  });

  it('skips ids that arrive empty rather than storing blanks', () => {
    const input = toUpsertInput('rens', CUSTOMER_ID, record({ customerNo: '', sfscAccountId: '' }));

    assert.equal(input.externalIds.length, 1);
  });
});

describe('toUpsertInput profile', () => {
  it('passes lastName through as SFCC sent it', () => {
    assert.equal(toUpsertInput('rens', CUSTOMER_ID, record()).profile.lastName, 'Lovelace');

    // Absent stays absent. The column is nullable, and both `undefined` and
    // `null` reach the store as NULL — profileInsertValues coalesces on insert,
    // and buildUpsertProfileSet skips on `!= null` — so a customer SFCC cannot
    // name is provisioned rather than rejected.
    assert.equal(
      toUpsertInput('rens', CUSTOMER_ID, record({ lastName: undefined })).profile.lastName,
      undefined,
    );
  });

  it('normalizes the locale and keeps the phones apart', () => {
    const input = toUpsertInput(
      'rens',
      CUSTOMER_ID,
      record({ preferredLocale: 'fr-CA', phoneHome: '514-555-0000', phoneMobile: '514-555-1111' }),
    );

    assert.equal(input.profile.language, 'fr');
    assert.equal(input.profile.phoneHome, '514-555-0000');
    assert.equal(input.profile.phoneMobile, '514-555-1111');
  });

  it('carries the custom preferredStore attribute through', () => {
    const input = toUpsertInput('rens', CUSTOMER_ID, record({ preferredStore: 'liberty-village' }));

    assert.equal(input.profile.preferredStore, 'liberty-village');
  });

  it('leaves the SFSC-sourced fields unset — SFCC has no source for them', () => {
    const input = toUpsertInput('rens', CUSTOMER_ID, record());

    assert.equal(input.profile.gender, undefined);
    assert.equal(input.profile.salutation, undefined);
    assert.equal(input.profile.postalCode, undefined);
  });

  it('marks source and brand', () => {
    const input = toUpsertInput('mondou', CUSTOMER_ID, record());

    assert.equal(input.source, 'SFCC');
    assert.equal(input.brand, 'mondou');
  });
});

describe('toUpsertInput addresses', () => {
  it('maps SFCC address fields onto the stored column names', () => {
    const input = toUpsertInput(
      'rens',
      CUSTOMER_ID,
      record({
        addresses: [
          {
            addressId: 'Home',
            address1: '1 Rue Sainte-Catherine',
            address2: 'Apartment 49',
            city: 'Montreal',
            stateCode: 'QC',
            postalCode: 'A1B 2C3',
            countryCode: 'CA',
            phone: '514 555 5555',
            phoneType: 'mobile',
            preferred: true,
          },
        ],
      }),
    );

    const [address] = input.addresses;
    assert.ok(address);
    assert.equal(address.sfccAddressId, 'Home');
    assert.equal(address.street1, '1 Rue Sainte-Catherine');
    assert.equal(address.street2, 'Apartment 49');
    assert.equal(address.phoneType, 'mobile');
    assert.equal(address.isPreferred, true);
  });

  it('maps a missing addressId to null, never an empty string', () => {
    // '' would collide every unidentified address on ('', customerId) under
    // customer_address_sfcc_id_uq, whose predicate is IS NOT NULL.
    const input = toUpsertInput('rens', CUSTOMER_ID, record({ addresses: [{ city: 'Montreal' }] }));

    assert.equal(input.addresses[0]?.sfccAddressId, null);
  });

  it('defaults isPreferred to false when SFCC omits it', () => {
    const input = toUpsertInput(
      'rens',
      CUSTOMER_ID,
      record({ addresses: [{ addressId: 'Work' }] }),
    );

    assert.equal(input.addresses[0]?.isPreferred, false);
  });

  it('yields an empty list when the customer has no addresses', () => {
    assert.deepEqual(toUpsertInput('rens', CUSTOMER_ID, record()).addresses, []);
  });
});

describe('toCustomerProfile from an SFCC record — the degraded path', () => {
  it('collapses the phones mobile-first and carries no paymentInstruments', () => {
    const profile = toCustomerProfile(
      record({ phoneHome: '514-555-0000', phoneMobile: '514-555-1111' }),
    );

    assert.equal(profile.phone, '514-555-1111');
    assert.equal('paymentInstruments' in profile, false);
  });

  it('falls back through home then business', () => {
    assert.equal(toCustomerProfile(record({ phoneHome: '514-555-0000' })).phone, '514-555-0000');
    assert.equal(
      toCustomerProfile(record({ phoneBusiness: '514-555-2222' })).phone,
      '514-555-2222',
    );
  });

  it('builds fullName from the parts it has', () => {
    const profile = toCustomerProfile(
      record({ addresses: [{ firstName: 'Ada', lastName: 'Lovelace' }] }),
    );

    assert.equal(profile.addresses?.[0]?.fullName, 'Ada Lovelace');
    assert.equal(
      toCustomerProfile(record({ addresses: [{}] })).addresses?.[0]?.fullName,
      undefined,
    );
  });
});
