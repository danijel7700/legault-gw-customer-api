import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GetCustomerResponse } from '../types/customers.types.js';

import { toSfccCustomerRecord, toUpdateCustomerRequest } from './customer.mapper.js';

const CUSTOMER_ID = 'abdcFEEDZcZbCdJwFRg9G66g2w';

function response(overrides: Partial<GetCustomerResponse> = {}): GetCustomerResponse {
  return { customerId: CUSTOMER_ID, ...overrides };
}

describe('toSfccCustomerRecord', () => {
  it('renames the custom attributes it stores and drops the rest', () => {
    const record = toSfccCustomerRecord(
      response({
        c_postalCode: 'A1A 1A1',
        c_preferredStore: '2078',
        c_sscid: '001As000012CCASIA4',
        c_ssccid: '003As0000177KdjIAE',
      }),
    );

    assert.equal(record.postalCode, 'A1A 1A1');
    assert.equal(record.preferredStore, '2078');
    assert.equal(record.sfscAccountId, '001As000012CCASIA4');
    assert.equal(record.sfscPersonContactId, '003As0000177KdjIAE');

    // Nothing prefixed c_ survives the boundary.
    assert.equal(
      Object.keys(record).some((key) => key.startsWith('c_')),
      false,
    );
  });

  it('never forwards the identity and session fields SFCC also returns', () => {
    const record = toSfccCustomerRecord({
      ...response(),
      hashedLogin: 'e4f2...',
      authType: 'registered',
      lastLoginTime: '2026-08-14T08:19:25.594Z',
      paymentInstruments: [{ paymentInstrumentId: 'fd9b84035c8cf8abfbf116674c' }],
    } as GetCustomerResponse);

    for (const leaked of [
      'hashedLogin',
      'authType',
      'lastLoginTime',
      'paymentInstruments',
      'c_postalCode',
    ]) {
      assert.equal(leaked in record, false, `${leaked} must not cross the provider boundary`);
    }
  });

  it('reads an empty string as "SFCC has nothing"', () => {
    // Otherwise a cleared mobile would shadow a real home number: the response
    // mappers pick with `??`, which does not fall through ''.
    const record = toSfccCustomerRecord(
      response({ phoneMobile: '', phoneHome: '514-555-0000', c_postalCode: '' }),
    );

    assert.equal(record.phoneMobile, undefined);
    assert.equal(record.phoneHome, '514-555-0000');
    assert.equal(record.postalCode, undefined);
  });
});

describe('toUpdateCustomerRequest', () => {
  it('renames the two custom attributes on the way out', () => {
    const body = toUpdateCustomerRequest({ postalCode: 'H2X1Y4', preferredStore: '2078' });

    assert.equal(body.c_postalCode, 'H2X1Y4');
    assert.equal(body.c_preferredStore, '2078');
  });

  it('omits what the request never mentioned', () => {
    const body = toUpdateCustomerRequest({ firstName: 'Ada' });

    assert.deepEqual(Object.keys(body), ['firstName']);
    assert.equal('c_postalCode' in body, false);
    assert.equal('lastName' in body, false);
  });

  it('sends the clear sentinel for a null', () => {
    // Pins CLEAR_VALUE. Whether SCAPI clears on null or needs '' is unverified
    // against the sandbox — if it flips, this assertion fails before anything
    // reaches SFCC.
    const body = toUpdateCustomerRequest({
      firstName: null,
      lastName: null,
      phoneHome: null,
      phoneMobile: null,
      postalCode: null,
      preferredStore: null,
    });

    assert.deepEqual(body, {
      firstName: null,
      lastName: null,
      phoneHome: null,
      phoneMobile: null,
      c_postalCode: null,
      c_preferredStore: null,
    });
  });

  it('emits exactly six keys for a full patch and never a seventh', () => {
    const body = toUpdateCustomerRequest({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phoneHome: null,
      phoneMobile: '514-555-1111',
      postalCode: 'H2X1Y4',
      preferredStore: '2078',
    });

    assert.deepEqual(Object.keys(body).sort(), [
      'c_postalCode',
      'c_preferredStore',
      'firstName',
      'lastName',
      'phoneHome',
      'phoneMobile',
    ]);
  });

  it('emits nothing at all for an empty update', () => {
    assert.deepEqual(toUpdateCustomerRequest({}), {});
  });
});
