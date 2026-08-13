import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import type * as schema from '../../../../database/schemas/index.js';
import type {
  Brand,
  Customer,
  CustomerAddress,
  ExternalIdType,
  ExternalSystem,
  Gender,
  Language,
  SourceSystem,
} from '../../../../database/schemas/customer/index.js';

export type Db = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export interface ExternalIdInput {
  readonly system: ExternalSystem;
  readonly idType: ExternalIdType;
  readonly value: string;
}

export interface CreateProfileInput {
  readonly email?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly salutation?: string | null;
  readonly gender?: Gender | null;
  readonly birthDate?: string | null;
  readonly language?: Language | null;
  readonly phoneHome?: string | null;
  readonly phoneMobile?: string | null;
  readonly postalCode?: string | null;
  readonly preferredStore?: string | null;
}

export interface CreateAddressInput {
  readonly sfccAddressId?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly street1?: string | null;
  readonly street2?: string | null;
  readonly city?: string | null;
  readonly stateCode?: string | null;
  readonly postalCode?: string | null;
  readonly countryCode?: string | null;
  readonly phone?: string | null;
  readonly phoneType?: string | null;
  readonly isPreferred?: boolean;
}

export interface CreateCustomerInput {
  readonly brand: Brand;
  readonly profile: CreateProfileInput;
  readonly source: SourceSystem;
  readonly externalIds: readonly ExternalIdInput[];
  readonly addresses: readonly CreateAddressInput[];
}

export interface UpdateProfileInput {
  readonly email?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly salutation?: string | null;
  readonly gender?: Gender | null;
  readonly birthDate?: string | null;
  readonly language?: Language | null;
  readonly phoneHome?: string | null;
  readonly phoneMobile?: string | null;
  readonly postalCode?: string | null;
  readonly preferredStore?: string | null;
}

export interface UpdateProfileOptions {
  readonly modifiedBy: SourceSystem;
  readonly expectedVersion?: number;
}

export interface UpsertFromSfccInput {
  readonly brand: Brand;
  readonly source: SourceSystem;
  readonly profile: CreateProfileInput;
  readonly externalIds: readonly ExternalIdInput[];
  readonly addresses: readonly CreateAddressInput[];
}

export interface UpsertAddressInput extends CreateAddressInput {
  /** Match key when `sfccAddressId` is absent. Omit to insert a new row. */
  readonly id?: string;
}

export interface UpsertFromSfccResult {
  readonly customer: Customer;
  readonly created: boolean;
}

export interface CustomerRepository {
  findById(id: string): Promise<Customer | null>;
  findByExternalId(
    brand: Brand,
    system: ExternalSystem,
    idType: string,
    value: string,
  ): Promise<Customer | null>;
  findByEmail(brand: Brand, email: string): Promise<Customer | null>;

  create(input: CreateCustomerInput): Promise<Customer>;
  updateProfile(
    id: string,
    patch: UpdateProfileInput,
    opts: UpdateProfileOptions,
  ): Promise<Customer>;
  upsertFromSfcc(input: UpsertFromSfccInput): Promise<UpsertFromSfccResult>;

  listAddresses(customerId: string): Promise<CustomerAddress[]>;
  upsertAddress(customerId: string, input: UpsertAddressInput): Promise<CustomerAddress>;
  deleteAddress(customerId: string, addressId: string): Promise<void>;
  setPreferredAddress(customerId: string, addressId: string): Promise<void>;
}
