import type { Brand, Gender, Language, SourceSystem } from '../enums/index.js';

import type { CustomerAddress } from './customer-address.types.js';
import type { ExternalId } from './external-id.types.js';

export interface CustomerProfile {
  readonly email: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly salutation: string | null;
  readonly gender: Gender | null;
  readonly birthDate: string | null;
  readonly language: Language | null;
  readonly phoneHome: string | null;
  readonly phoneMobile: string | null;
  readonly postalCode: string | null;
  readonly preferredStore: string | null;
}

/** Provenance and concurrency. Also a grouping of columns on `customer`. */
export interface CustomerMetadata {
  readonly source: SourceSystem;
  readonly lastModifiedBy: SourceSystem;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The aggregate the API layer speaks, decoupled from Drizzle's inferred rows. */
export interface Customer {
  readonly id: string;
  readonly brand: Brand;
  readonly externalIds: readonly ExternalId[];
  readonly profile: CustomerProfile;
  readonly addresses: readonly CustomerAddress[];
  readonly metadata: CustomerMetadata;
}
