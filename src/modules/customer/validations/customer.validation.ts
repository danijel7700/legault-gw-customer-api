import { z } from 'zod';

import {
  PHONE_TYPES,
  type CustomerIdentity,
  type UpdateMemberProfileRequest,
} from '../types/customer.types.js';

export const CUSTOMER_ID_HEADER = 'x-customer-id';
export const ACCESS_TOKEN_HEADER = 'authorization';

const CUSTOMER_ID_PATTERN = /^[\w.~-]+$/;

const BEARER_TOKEN_PATTERN = /^Bearer\s+\S+$/i;
const BEARER_SCHEME_PATTERN = /^Bearer\s+/i;
const ACCESS_TOKEN_MAX_LENGTH = 4096;

export const customerIdentitySchema = z
  .object({
    [CUSTOMER_ID_HEADER]: z
      .string()
      .trim()
      .min(1, `${CUSTOMER_ID_HEADER} header is required`)
      .max(128, `${CUSTOMER_ID_HEADER} header is too long`)
      .regex(CUSTOMER_ID_PATTERN, `${CUSTOMER_ID_HEADER} header contains invalid characters`),
    [ACCESS_TOKEN_HEADER]: z
      .string()
      .trim()
      .min(1, `${ACCESS_TOKEN_HEADER} header is required`)
      .max(ACCESS_TOKEN_MAX_LENGTH, `${ACCESS_TOKEN_HEADER} header is too long`)
      .regex(BEARER_TOKEN_PATTERN, `${ACCESS_TOKEN_HEADER} header must be a Bearer token`)
      .transform((header) => header.replace(BEARER_SCHEME_PATTERN, '')),
  })
  .transform((headers): CustomerIdentity => ({
    customerId: headers[CUSTOMER_ID_HEADER],
    accessToken: headers[ACCESS_TOKEN_HEADER],
  }));

const FIRST_NAME_MAX = 40;
const LAST_NAME_MAX = 80;
const PHONE_MAX = 32;
const POSTAL_CODE_MAX = 16;
const PREFERRED_STORE_MAX = 64;

function clearable(max: number, field: string): z.ZodOptional<z.ZodNullable<z.ZodString>> {
  return z
    .string()
    .trim()
    .min(1, `${field} cannot be blank — send null to clear it`)
    .max(max, `${field} is too long`)
    .nullable()
    .optional();
}

export const updateProfileSchema: z.ZodType<UpdateMemberProfileRequest> = z
  .strictObject({
    firstName: clearable(FIRST_NAME_MAX, 'firstName'),
    lastName: clearable(LAST_NAME_MAX, 'lastName'),
    phone: clearable(PHONE_MAX, 'phone'),
    phoneType: z.enum(PHONE_TYPES).optional(),
    postalCode: clearable(POSTAL_CODE_MAX, 'postalCode'),
    preferredStore: clearable(PREFERRED_STORE_MAX, 'preferredStore'),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'At least one field must be supplied',
  })
  .refine((patch) => patch.phoneType === undefined || patch.phone !== undefined, {
    message: 'phoneType is only meaningful alongside phone',
    path: ['phoneType'],
  });
