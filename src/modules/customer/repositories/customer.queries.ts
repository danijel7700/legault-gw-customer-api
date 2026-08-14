import { and, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import {
  customer,
  normalizeEmail,
  normalizePostalCode,
  type Brand,
  type Customer,
  type NewCustomerRow,
  type SourceSystem,
} from '../../../database/schemas/customer/index.js';
import { CustomerNotFoundError, CustomerVersionConflictError } from '../errors/customer.error.js';
import { toCustomer } from '../mappers/customer.mapper.js';

import type {
  CreateProfileInput,
  Db,
  UpdateProfileInput,
} from './types/customer.repository.types.js';

export type CustomerUpdateSet = PgUpdateSetSource<typeof customer>;

type ProfileInsertValues = Required<
  Pick<
    NewCustomerRow,
    | 'email'
    | 'firstName'
    | 'lastName'
    | 'salutation'
    | 'gender'
    | 'birthDate'
    | 'language'
    | 'phoneHome'
    | 'phoneMobile'
    | 'postalCode'
    | 'preferredStore'
  >
>;

export async function findAggregate(db: Db, id: string): Promise<Customer | null> {
  const row = await db.query.customer.findFirst({
    where: eq(customer.id, id),
    with: { externalIds: true, addresses: true },
  });

  return row === undefined ? null : toCustomer(row);
}

export async function requireAggregate(db: Db, id: string): Promise<Customer> {
  const aggregate = await findAggregate(db, id);

  if (aggregate === null) {
    throw new CustomerNotFoundError(id);
  }

  return aggregate;
}

export async function requireCustomerBrand(db: Db, id: string): Promise<Brand> {
  const [row] = await db
    .select({ brand: customer.brand })
    .from(customer)
    .where(eq(customer.id, id))
    .limit(1);

  if (row === undefined) {
    throw new CustomerNotFoundError(id);
  }

  return row.brand;
}

export async function findCustomerIdByEmail(
  db: Db,
  brand: Brand,
  rawEmail: string | null | undefined,
): Promise<string | undefined> {
  const email = normalizeEmail(rawEmail);

  if (email === null) {
    return undefined;
  }

  const [match] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.brand, brand), eq(customer.email, email)))
    .limit(1);

  return match?.id;
}

function profileInsertValues(profile: CreateProfileInput): ProfileInsertValues {
  return {
    email: normalizeEmail(profile.email),
    firstName: profile.firstName ?? null,
    lastName: profile.lastName ?? null,
    salutation: profile.salutation ?? null,
    gender: profile.gender ?? null,
    birthDate: profile.birthDate ?? null,
    language: profile.language ?? null,
    phoneHome: profile.phoneHome ?? null,
    phoneMobile: profile.phoneMobile ?? null,
    postalCode: normalizePostalCode(profile.postalCode),
    preferredStore: profile.preferredStore ?? null,
  };
}

export async function insertCustomerRow(
  tx: Db,
  brand: Brand,
  profile: CreateProfileInput,
  source: SourceSystem,
): Promise<string> {
  const [row] = await tx
    .insert(customer)
    .values({
      brand,
      ...profileInsertValues(profile),
      source,
      lastModifiedBy: source,
      version: 1,
    })
    .returning({ id: customer.id });

  if (row === undefined) {
    throw new Error('Customer insert returned no row');
  }

  return row.id;
}

export function buildProfilePatch(patch: UpdateProfileInput): CustomerUpdateSet {
  const set: CustomerUpdateSet = {};

  if (patch.email !== undefined) {
    set.email = normalizeEmail(patch.email);
  }
  if (patch.firstName !== undefined) {
    set.firstName = patch.firstName;
  }
  if (patch.lastName !== undefined) {
    set.lastName = patch.lastName;
  }
  if (patch.salutation !== undefined) {
    set.salutation = patch.salutation;
  }
  if (patch.gender !== undefined) {
    set.gender = patch.gender;
  }
  if (patch.birthDate !== undefined) {
    set.birthDate = patch.birthDate;
  }
  if (patch.language !== undefined) {
    set.language = patch.language;
  }
  if (patch.phoneHome !== undefined) {
    set.phoneHome = patch.phoneHome;
  }
  if (patch.phoneMobile !== undefined) {
    set.phoneMobile = patch.phoneMobile;
  }
  if (patch.postalCode !== undefined) {
    set.postalCode = normalizePostalCode(patch.postalCode);
  }
  if (patch.preferredStore !== undefined) {
    set.preferredStore = patch.preferredStore;
  }

  return set;
}

export function buildUpsertProfileSet(profile: CreateProfileInput): CustomerUpdateSet {
  const set: CustomerUpdateSet = {};
  const email = normalizeEmail(profile.email);

  if (email !== null) {
    set.email = email;
  }
  if (profile.firstName != null) {
    set.firstName = profile.firstName;
  }

  if (profile.lastName != null) {
    set.lastName = profile.lastName;
  }
  if (profile.salutation != null) {
    set.salutation = profile.salutation;
  }
  if (profile.gender != null) {
    set.gender = profile.gender;
  }
  if (profile.birthDate != null) {
    set.birthDate = profile.birthDate;
  }
  if (profile.language != null) {
    set.language = profile.language;
  }
  if (profile.phoneHome != null) {
    set.phoneHome = profile.phoneHome;
  }
  if (profile.phoneMobile != null) {
    set.phoneMobile = profile.phoneMobile;
  }

  const postalCode = normalizePostalCode(profile.postalCode);

  if (postalCode !== null) {
    set.postalCode = postalCode;
  }
  if (profile.preferredStore != null) {
    set.preferredStore = profile.preferredStore;
  }

  return set;
}

export function stampWrite(set: CustomerUpdateSet, modifiedBy: SourceSystem): CustomerUpdateSet {
  set.version = sql`${customer.version} + 1`;
  set.lastModifiedBy = modifiedBy;
  set.updatedAt = new Date();

  return set;
}

export async function applyCustomerUpdate(
  tx: Db,
  id: string,
  set: CustomerUpdateSet,
  expectedVersion: number | undefined,
): Promise<boolean> {
  const where =
    expectedVersion === undefined
      ? eq(customer.id, id)
      : and(eq(customer.id, id), eq(customer.version, expectedVersion));

  const updated = await tx.update(customer).set(set).where(where).returning({ id: customer.id });

  return updated.length > 0;
}

export async function throwUpdateFailure(
  tx: Db,
  id: string,
  expectedVersion: number | undefined,
): Promise<never> {
  const [existing] = await tx
    .select({ version: customer.version })
    .from(customer)
    .where(eq(customer.id, id))
    .limit(1);

  if (existing === undefined) {
    throw new CustomerNotFoundError(id);
  }

  throw new CustomerVersionConflictError(id, expectedVersion ?? existing.version, existing.version);
}

export async function bumpCustomerVersion(tx: Db, customerId: string): Promise<void> {
  await tx
    .update(customer)
    .set({ version: sql`${customer.version} + 1`, updatedAt: new Date() })
    .where(eq(customer.id, customerId));
}
