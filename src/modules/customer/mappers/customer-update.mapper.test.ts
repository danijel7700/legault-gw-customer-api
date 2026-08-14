import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { UpdateMemberProfileRequest } from '../types/customer.types.js';

import { toSfccCustomerUpdate, toUpdateProfileInput } from './customer-update.mapper.js';

/**
 * Both mappers are asserted on key *presence*, not only on value. An absent key
 * and a key set to `undefined` mean the same thing to `deepEqual` and opposite
 * things to everything downstream: `buildProfilePatch` and the SCAPI body both
 * branch on `!== undefined`, so a stray key would clear a column or send SFCC a
 * field the caller never mentioned.
 */
describe('toSfccCustomerUpdate — the phone switch', () => {
  it('defaults an untyped phone to mobile and clears home', () => {
    const update = toSfccCustomerUpdate({ phone: '514-555-1111' });

    assert.equal(update.phoneMobile, '514-555-1111');
    assert.equal(update.phoneHome, null);
  });

  it('moves the number to home and clears mobile', () => {
    const update = toSfccCustomerUpdate({ phone: '514-555-0000', phoneType: 'home' });

    assert.equal(update.phoneHome, '514-555-0000');
    // The point of the switch: the old mobile is what `phoneMobile ?? phoneHome`
    // would otherwise keep returning.
    assert.equal(update.phoneMobile, null);
  });

  it('clears both columns when phone is null', () => {
    const update = toSfccCustomerUpdate({ phone: null });

    assert.equal(update.phoneHome, null);
    assert.equal(update.phoneMobile, null);
  });

  it('ignores phoneType when phone is null — clearing has no direction', () => {
    const update = toSfccCustomerUpdate({ phone: null, phoneType: 'home' });

    assert.equal(update.phoneHome, null);
    assert.equal(update.phoneMobile, null);
  });

  it('emits no phone keys at all when phone is absent', () => {
    const update = toSfccCustomerUpdate({ firstName: 'Ada' });

    assert.equal('phoneMobile' in update, false);
    assert.equal('phoneHome' in update, false);
  });
});

describe('toSfccCustomerUpdate — key presence', () => {
  it('keeps a null so it can clear, and omits what was never mentioned', () => {
    const update = toSfccCustomerUpdate({ firstName: null });

    assert.equal('firstName' in update, true);
    assert.equal(update.firstName, null);

    assert.equal('lastName' in update, false);
    assert.equal('postalCode' in update, false);
    assert.equal('preferredStore' in update, false);
  });

  it('passes postalCode and preferredStore through verbatim', () => {
    // Un-normalized on purpose: SFCC has other consumers reading c_postalCode,
    // and the compact form is this store's convention, not theirs.
    const update = toSfccCustomerUpdate({ postalCode: 'h2x 1y4', preferredStore: '2078' });

    assert.equal(update.postalCode, 'h2x 1y4');
    assert.equal(update.preferredStore, '2078');
  });

  it('emits exactly the six fields for a full patch and nothing else', () => {
    const update = toSfccCustomerUpdate({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '514-555-1111',
      phoneType: 'mobile',
      postalCode: 'H2X1Y4',
      preferredStore: '2078',
    });

    assert.deepEqual(Object.keys(update).sort(), [
      'firstName',
      'lastName',
      'phoneHome',
      'phoneMobile',
      'postalCode',
      'preferredStore',
    ]);
  });
});

describe('toUpdateProfileInput', () => {
  it('applies the same phone switch to the stored columns', () => {
    assert.deepEqual(toUpdateProfileInput({ phone: '514-555-1111' }), {
      phoneHome: null,
      phoneMobile: '514-555-1111',
    });

    assert.deepEqual(toUpdateProfileInput({ phone: '514-555-0000', phoneType: 'home' }), {
      phoneHome: '514-555-0000',
      phoneMobile: null,
    });

    assert.deepEqual(toUpdateProfileInput({ phone: null }), {
      phoneHome: null,
      phoneMobile: null,
    });
  });

  it('leaves postalCode un-normalized — that is the repository boundary', () => {
    assert.equal(toUpdateProfileInput({ postalCode: 'h2x 1y4' }).postalCode, 'h2x 1y4');
  });

  it('clears with null and leaves absent fields absent', () => {
    const patch = toUpdateProfileInput({ lastName: null });

    assert.equal('lastName' in patch, true);
    assert.equal(patch.lastName, null);
    assert.equal('firstName' in patch, false);
  });

  it('never reaches a field the endpoint does not expose', () => {
    const requests: UpdateMemberProfileRequest[] = [
      {},
      { firstName: 'Ada' },
      { firstName: null, lastName: null, phone: null, postalCode: null, preferredStore: null },
      { phone: '514-555-1111', phoneType: 'home', postalCode: 'H2X1Y4', preferredStore: '2078' },
    ];

    // UpdateProfileInput also carries email, birthDate, language, salutation and
    // gender. This endpoint cannot change any of them, and a key present with
    // `undefined` is still a key `buildProfilePatch` would act on.
    for (const request of requests) {
      const keys = Object.keys(toUpdateProfileInput(request));

      for (const forbidden of ['email', 'birthDate', 'language', 'salutation', 'gender']) {
        assert.equal(keys.includes(forbidden), false, `${forbidden} must never be patched`);
      }
    }
  });
});
