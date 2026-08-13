import { and, eq, or } from 'drizzle-orm';

import {
  customerExternalId,
  type Brand,
  type ExternalSystem,
} from '../../../database/schemas/customer/index.js';
import { DuplicateExternalIdError } from '../errors/customer.error.js';

import type { Db, ExternalIdInput } from './types/customer.repository.types.js';

export async function findCustomerIdByExternalId(
  db: Db,
  brand: Brand,
  system: ExternalSystem,
  idType: string,
  value: string,
): Promise<string | undefined> {
  const [match] = await db
    .select({ customerId: customerExternalId.customerId })
    .from(customerExternalId)
    .where(
      and(
        eq(customerExternalId.brand, brand),
        eq(customerExternalId.system, system),
        eq(customerExternalId.idType, idType),
        eq(customerExternalId.value, value),
      ),
    )
    .limit(1);

  return match?.customerId;
}

export async function findCustomerIdByAnyExternalId(
  db: Db,
  brand: Brand,
  externalIds: readonly ExternalIdInput[],
): Promise<string | undefined> {
  if (externalIds.length === 0) {
    return undefined;
  }

  const [match] = await db
    .select({ customerId: customerExternalId.customerId })
    .from(customerExternalId)
    .where(
      and(
        eq(customerExternalId.brand, brand),
        or(
          ...externalIds.map((external) =>
            and(
              eq(customerExternalId.system, external.system),
              eq(customerExternalId.idType, external.idType),
              eq(customerExternalId.value, external.value),
            ),
          ),
        ),
      ),
    )
    .limit(1);

  return match?.customerId;
}

export async function insertExternalIds(
  tx: Db,
  customerId: string,
  brand: Brand,
  externalIds: readonly ExternalIdInput[],
): Promise<void> {
  if (externalIds.length === 0) {
    return;
  }

  await tx.insert(customerExternalId).values(
    externalIds.map((external) => ({
      customerId,
      brand,
      system: external.system,
      idType: external.idType,
      value: external.value,
    })),
  );
}

export async function linkExternalIds(
  tx: Db,
  customerId: string,
  brand: Brand,
  externalIds: readonly ExternalIdInput[],
): Promise<void> {
  for (const external of externalIds) {
    const [existing] = await tx
      .select({ customerId: customerExternalId.customerId })
      .from(customerExternalId)
      .where(
        and(
          eq(customerExternalId.brand, brand),
          eq(customerExternalId.system, external.system),
          eq(customerExternalId.idType, external.idType),
          eq(customerExternalId.value, external.value),
        ),
      )
      .limit(1);

    if (existing === undefined) {
      await tx.insert(customerExternalId).values({
        customerId,
        brand,
        system: external.system,
        idType: external.idType,
        value: external.value,
      });
      continue;
    }

    if (existing.customerId !== customerId) {
      throw new DuplicateExternalIdError(external.system, external.idType, existing.customerId);
    }
  }
}
