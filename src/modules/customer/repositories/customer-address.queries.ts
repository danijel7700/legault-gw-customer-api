import { and, eq, ne } from 'drizzle-orm';

import {
  customerAddress,
  normalizePostalCode,
  type Brand,
  type CustomerAddress,
  type NewCustomerAddressRow,
} from '../../../database/schemas/customer/index.js';
import { NotFoundError } from '../../../shared/errors/index.js';
import { toCustomerAddress } from '../mappers/customer.mapper.js';

import type {
  CreateAddressInput,
  Db,
  UpsertAddressInput,
} from './types/customer.repository.types.js';

type AddressValues = Required<
  Pick<
    NewCustomerAddressRow,
    | 'sfccAddressId'
    | 'firstName'
    | 'lastName'
    | 'street1'
    | 'street2'
    | 'city'
    | 'stateCode'
    | 'postalCode'
    | 'countryCode'
    | 'phone'
    | 'phoneType'
    | 'isPreferred'
  >
>;

function addressValues(input: CreateAddressInput): AddressValues {
  return {
    sfccAddressId: input.sfccAddressId ?? null,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    street1: input.street1 ?? null,
    street2: input.street2 ?? null,
    city: input.city ?? null,
    stateCode: input.stateCode ?? null,
    postalCode: normalizePostalCode(input.postalCode),
    countryCode: input.countryCode ?? null,
    phone: input.phone ?? null,
    phoneType: input.phoneType ?? null,
    isPreferred: input.isPreferred ?? false,
  };
}

export async function listAddressRows(db: Db, customerId: string): Promise<CustomerAddress[]> {
  const rows = await db
    .select()
    .from(customerAddress)
    .where(eq(customerAddress.customerId, customerId));

  return rows.map(toCustomerAddress);
}

export async function insertAddress(
  tx: Db,
  customerId: string,
  brand: Brand,
  input: CreateAddressInput,
): Promise<CustomerAddress> {
  const [row] = await tx
    .insert(customerAddress)
    .values({ customerId, brand, ...addressValues(input) })
    .returning();

  if (row === undefined) {
    throw new Error('Address insert returned no row');
  }

  return toCustomerAddress(row);
}

export async function upsertAddressRow(
  tx: Db,
  customerId: string,
  brand: Brand,
  input: UpsertAddressInput,
): Promise<CustomerAddress> {
  const existingId = await findMatchingAddressId(tx, customerId, input);

  if (input.isPreferred === true) {
    await clearPreferredAddress(tx, customerId, existingId);
  }

  if (existingId === undefined) {
    return insertAddress(tx, customerId, brand, input);
  }

  const [row] = await tx
    .update(customerAddress)
    .set({ ...addressValues(input), updatedAt: new Date() })
    .where(eq(customerAddress.id, existingId))
    .returning();

  if (row === undefined) {
    throw new NotFoundError('Address not found');
  }

  return toCustomerAddress(row);
}

async function findMatchingAddressId(
  tx: Db,
  customerId: string,
  input: UpsertAddressInput,
): Promise<string | undefined> {
  const match =
    input.sfccAddressId != null
      ? eq(customerAddress.sfccAddressId, input.sfccAddressId)
      : input.id !== undefined
        ? eq(customerAddress.id, input.id)
        : undefined;

  if (match === undefined) {
    return undefined;
  }

  const [row] = await tx
    .select({ id: customerAddress.id })
    .from(customerAddress)
    .where(and(eq(customerAddress.customerId, customerId), match))
    .limit(1);

  return row?.id;
}

export async function clearPreferredAddress(
  tx: Db,
  customerId: string,
  exceptId: string | undefined,
): Promise<void> {
  const where =
    exceptId === undefined
      ? and(eq(customerAddress.customerId, customerId), eq(customerAddress.isPreferred, true))
      : and(
          eq(customerAddress.customerId, customerId),
          eq(customerAddress.isPreferred, true),
          ne(customerAddress.id, exceptId),
        );

  await tx.update(customerAddress).set({ isPreferred: false, updatedAt: new Date() }).where(where);
}

export async function deleteAddressRow(
  tx: Db,
  customerId: string,
  addressId: string,
): Promise<boolean> {
  const deleted = await tx
    .delete(customerAddress)
    .where(and(eq(customerAddress.customerId, customerId), eq(customerAddress.id, addressId)))
    .returning({ id: customerAddress.id });

  return deleted.length > 0;
}

export async function setPreferredFlag(
  tx: Db,
  customerId: string,
  addressId: string,
): Promise<boolean> {
  const updated = await tx
    .update(customerAddress)
    .set({ isPreferred: true, updatedAt: new Date() })
    .where(and(eq(customerAddress.customerId, customerId), eq(customerAddress.id, addressId)))
    .returning({ id: customerAddress.id });

  return updated.length > 0;
}
