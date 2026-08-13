import { z } from 'zod';

import type { CustomerIdentity } from '../types/customer.types.js';

export const CUSTOMER_ID_HEADER = 'x-customer-id';
export const ACCESS_TOKEN_HEADER = 'authorization';

const CUSTOMER_ID_PATTERN = /^[\w.~-]+$/;

// The scheme is matched to reject a bare token, then stripped to leave the
// credential. The token is a ~1.2 kB ES256 JWT; the ceiling is slack on top of
// that, not a measurement.
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
