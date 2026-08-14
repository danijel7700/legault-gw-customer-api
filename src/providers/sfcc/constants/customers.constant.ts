export const CUSTOMER_NOT_FOUND_SLUGS: ReadonlySet<string> = new Set([
  'invalid-customer',
  'customer-not-found',
  'resource-not-found',
]);

export const INVALID_CUSTOMER_ID_SLUGS: ReadonlySet<string> = new Set([
  'invalid-customer-id',
  'invalid-request-parameter',
]);

export const CONCURRENT_MODIFICATION_SLUGS: ReadonlySet<string> = new Set([
  'concurrent-modification',
  'customer-concurrent-modification',
]);
