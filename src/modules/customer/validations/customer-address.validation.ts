import { z } from 'zod';

import {
  PHONE_TYPES,
  type CreateMemberAddressRequest,
  type UpdateMemberAddressRequest,
} from '../types/customer.types.js';

const DEFAULT_COUNTRY_CODE = 'CA';

const LABEL_MAX = 256;
const NAME_MAX = 80;
const STREET_MAX = 256;
const CITY_MAX = 128;
const STATE_CODE_MAX = 8;
const POSTAL_CODE_MAX = 16;
const COUNTRY_CODE_LENGTH = 2;
const PHONE_MAX = 32;

function text(max: number, field: string): z.ZodString {
  return z.string().trim().min(1, `${field} is required`).max(max, `${field} is too long`);
}

const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(COUNTRY_CODE_LENGTH, 'countryCode must be a two-letter ISO code');

export const addressParamsSchema: z.ZodType<{ id: string }> = z.object({
  id: z.uuid('address id must be a uuid'),
});

export const createAddressSchema: z.ZodType<CreateMemberAddressRequest> = z.strictObject({
  label: text(LABEL_MAX, 'label'),
  firstName: text(NAME_MAX, 'firstName'),
  lastName: text(NAME_MAX, 'lastName'),
  street1: text(STREET_MAX, 'street1'),
  street2: text(STREET_MAX, 'street2').nullable().optional(),
  city: text(CITY_MAX, 'city'),
  stateCode: text(STATE_CODE_MAX, 'stateCode'),
  postalCode: text(POSTAL_CODE_MAX, 'postalCode'),
  countryCode: countryCode.default(DEFAULT_COUNTRY_CODE),
  phone: text(PHONE_MAX, 'phone'),
  phoneType: z.enum(PHONE_TYPES).optional(),
});

export const updateAddressSchema: z.ZodType<UpdateMemberAddressRequest> = z
  .strictObject({
    label: text(LABEL_MAX, 'label').optional(),
    firstName: text(NAME_MAX, 'firstName').optional(),
    lastName: text(NAME_MAX, 'lastName').optional(),
    street1: text(STREET_MAX, 'street1').optional(),
    street2: text(STREET_MAX, 'street2').nullable().optional(),
    city: text(CITY_MAX, 'city').optional(),
    stateCode: text(STATE_CODE_MAX, 'stateCode').optional(),
    postalCode: text(POSTAL_CODE_MAX, 'postalCode').optional(),
    countryCode: countryCode.optional(),
    phone: text(PHONE_MAX, 'phone').optional(),
    phoneType: z.enum(PHONE_TYPES).nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'At least one field must be supplied',
  });
