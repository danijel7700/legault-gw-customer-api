import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { updateProfileSchema } from './customer.validation.js';

function parse(body: unknown): ReturnType<typeof updateProfileSchema.safeParse> {
  return updateProfileSchema.safeParse(body);
}

function accepted(body: unknown): Record<string, unknown> {
  const result = parse(body);

  assert.ok(result.success, `expected ${JSON.stringify(body)} to be accepted`);

  return result.data as Record<string, unknown>;
}

function rejected(body: unknown): void {
  assert.equal(parse(body).success, false, `expected ${JSON.stringify(body)} to be rejected`);
}

describe('updateProfileSchema rejects', () => {
  it('an empty patch — it would burn an upstream write and a version bump', () => {
    rejected({});
  });

  it('a key it does not know, rather than silently dropping it', () => {
    // The whole reason for strictObject: `postalcode` would otherwise parse to
    // `{}` and answer 200 having changed nothing.
    rejected({ postalCode: 'H2X1Y4', postalcode: 'H2X1Y4' });
    rejected({ email: 'ada@example.com' });
  });

  it('phoneType without a phone beside it', () => {
    const result = parse({ phoneType: 'home' });

    assert.equal(result.success, false);
    assert.equal(result.error.issues[0]?.path.join('.'), 'phoneType');
  });

  it('a phoneType outside the two the store has columns for', () => {
    rejected({ phone: '514-555-1111', phoneType: 'work' });
  });

  it('blank and whitespace-only names — null is how you clear', () => {
    rejected({ firstName: '' });
    rejected({ firstName: '   ' });
    rejected({ lastName: '  ' });
    rejected({ preferredStore: '' });
  });

  it('values longer than SFCC would accept', () => {
    rejected({ firstName: 'a'.repeat(41) });
    rejected({ lastName: 'a'.repeat(81) });
  });

  it('a body that is not an object at all', () => {
    // Express 5 leaves req.body undefined without a JSON content type.
    rejected(undefined);
    rejected('firstName=Ada');
  });
});

describe('updateProfileSchema accepts', () => {
  it('null for every clearable field, lastName included', () => {
    const patch = accepted({
      firstName: null,
      lastName: null,
      phone: null,
      postalCode: null,
      preferredStore: null,
    });

    assert.deepEqual(patch, {
      firstName: null,
      lastName: null,
      phone: null,
      postalCode: null,
      preferredStore: null,
    });
  });

  it('a redundant phoneType alongside an explicit clear', () => {
    accepted({ phone: null, phoneType: 'home' });
  });

  it('a phone with no type, leaving phoneType absent for the mapper to default', () => {
    const patch = accepted({ phone: '514-555-1111' });

    // Not `.default('mobile')` — a default would make the key always present
    // and the phoneType-without-phone refine could never fire.
    assert.equal('phoneType' in patch, false);
  });

  it('and trims surrounding whitespace', () => {
    assert.equal(accepted({ firstName: '  Ada  ' }).firstName, 'Ada');
  });

  it('a single field on its own', () => {
    assert.deepEqual(accepted({ preferredStore: '2078' }), { preferredStore: '2078' });
  });
});
