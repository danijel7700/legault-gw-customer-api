import type { CustomerAddress as StoredAddress } from '../../../database/schemas/customer/index.js';
import { UnprocessableEntityError } from '../../../shared/errors/index.js';
import type { Mutable } from '../../../shared/types/utility.types.js';
import type { UpsertAddressInput } from '../repositories/types/customer.repository.types.js';
import type {
  CreateMemberAddressRequest,
  SfccAddressCreate,
  SfccAddressRecord,
  SfccAddressUpdate,
  UpdateMemberAddressRequest,
} from '../types/customer.types.js';

const DEFAULT_COUNTRY_CODE = 'CA';

export function toSfccAddressCreate(request: CreateMemberAddressRequest): SfccAddressCreate {
  const address: Mutable<SfccAddressCreate> = {
    addressId: request.label,
    firstName: request.firstName,
    lastName: request.lastName,
    street1: request.street1,
    city: request.city,
    stateCode: request.stateCode,
    postalCode: request.postalCode,
    countryCode: request.countryCode ?? DEFAULT_COUNTRY_CODE,
    phone: request.phone,
  };

  if (request.street2 !== undefined) {
    address.street2 = request.street2;
  }
  if (request.phoneType !== undefined) {
    address.phoneType = request.phoneType;
  }

  return address;
}

export function toSfccAddressUpdate(
  request: UpdateMemberAddressRequest,
  stored: StoredAddress,
): SfccAddressUpdate {
  const update: Mutable<SfccAddressUpdate> = {
    addressId: request.label ?? requireStored(stored, 'sfccAddressId'),
    countryCode: request.countryCode ?? requireStored(stored, 'countryCode'),
    lastName: request.lastName ?? requireStored(stored, 'lastName'),
  };

  if (request.firstName !== undefined) {
    update.firstName = request.firstName;
  }
  if (request.street1 !== undefined) {
    update.street1 = request.street1;
  }
  if (request.street2 !== undefined) {
    update.street2 = request.street2;
  }
  if (request.city !== undefined) {
    update.city = request.city;
  }
  if (request.stateCode !== undefined) {
    update.stateCode = request.stateCode;
  }
  if (request.postalCode !== undefined) {
    update.postalCode = request.postalCode;
  }
  if (request.phone !== undefined) {
    update.phone = request.phone;
  }
  if (request.phoneType !== undefined) {
    update.phoneType = request.phoneType;
  }

  return update;
}

export function toSfccPreferredUpdate(stored: StoredAddress): SfccAddressUpdate {
  return {
    addressId: requireStored(stored, 'sfccAddressId'),
    countryCode: requireStored(stored, 'countryCode'),
    lastName: requireStored(stored, 'lastName'),
    preferred: true,
  };
}

export function requireSfccAddressId(stored: StoredAddress): string {
  return requireStored(stored, 'sfccAddressId');
}

function requireStored(
  stored: StoredAddress,
  field: 'sfccAddressId' | 'countryCode' | 'lastName',
): string {
  const value = stored[field];

  if (value === null || value.length === 0) {
    throw new UnprocessableEntityError(
      `This address cannot be updated: it is stored without a ${field === 'sfccAddressId' ? 'SFCC address id' : field}`,
      { details: { addressId: stored.id, missing: field } },
    );
  }

  return value;
}

export function toUpsertAddressInput(
  record: SfccAddressRecord,
  stored?: StoredAddress,
): UpsertAddressInput {
  return {
    id: stored?.id,
    sfccAddressId: record.addressId ?? null,
    firstName: record.firstName ?? null,
    lastName: record.lastName ?? null,
    street1: record.address1 ?? null,
    street2: record.address2 ?? null,
    city: record.city ?? null,
    stateCode: record.stateCode ?? null,
    postalCode: record.postalCode ?? null,
    countryCode: record.countryCode ?? null,
    phone: record.phone ?? null,
    phoneType: record.phoneType ?? null,
    isPreferred: record.preferred ?? stored?.isPreferred ?? false,
  };
}
