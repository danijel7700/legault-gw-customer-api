import {
  EXTERNAL_ID_TYPES,
  normalizeLanguage,
  type Brand,
} from '../../../database/schemas/customer/index.js';
import type {
  CreateAddressInput,
  ExternalIdInput,
  UpsertFromSfccInput,
} from '../repositories/types/customer.repository.types.js';
import type {
  CustomerAddress,
  CustomerProfile,
  SfccAddressRecord,
  SfccCustomerRecord,
} from '../types/customer.types.js';

export function toUpsertInput(
  brand: Brand,
  customerId: string,
  record: SfccCustomerRecord,
): UpsertFromSfccInput {
  return {
    brand,
    source: 'SFCC',
    profile: {
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      birthDate: record.birthday,
      language: normalizeLanguage(record.preferredLocale),
      phoneHome: record.phoneHome,
      phoneMobile: record.phoneMobile,
      postalCode: record.postalCode,
      preferredStore: record.preferredStore,
    },
    externalIds: toExternalIds(customerId, record),
    addresses: record.addresses?.map(toCreateAddressInput) ?? [],
  };
}

function toExternalIds(customerId: string, record: SfccCustomerRecord): ExternalIdInput[] {
  const externalIds: ExternalIdInput[] = [
    { system: 'SFCC', idType: EXTERNAL_ID_TYPES.SFCC.CUSTOMER_ID, value: customerId },
  ];

  if (record.customerNo !== undefined && record.customerNo.length > 0) {
    externalIds.push({
      system: 'SFCC',
      idType: EXTERNAL_ID_TYPES.SFCC.CUSTOMER_NO,
      value: record.customerNo,
    });
  }

  if (record.sfscAccountId !== undefined && record.sfscAccountId.length > 0) {
    externalIds.push({
      system: 'SFSC',
      idType: EXTERNAL_ID_TYPES.SFSC.ACCOUNT_ID,
      value: record.sfscAccountId,
    });
  }

  if (record.sfscPersonContactId !== undefined && record.sfscPersonContactId.length > 0) {
    externalIds.push({
      system: 'SFSC',
      idType: EXTERNAL_ID_TYPES.SFSC.PERSON_CONTACT_ID,
      value: record.sfscPersonContactId,
    });
  }

  return externalIds;
}

function toCreateAddressInput(address: SfccAddressRecord): CreateAddressInput {
  return {
    sfccAddressId: address.addressId ?? null,
    firstName: address.firstName,
    lastName: address.lastName,
    street1: address.address1,
    street2: address.address2,
    city: address.city,
    stateCode: address.stateCode,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    phone: address.phone,
    phoneType: address.phoneType,
    isPreferred: address.preferred ?? false,
  };
}

export function toCustomerProfile(record: SfccCustomerRecord): CustomerProfile {
  return {
    email: record.email,
    firstName: record.firstName,
    lastName: record.lastName,
    phone: record.phoneMobile ?? record.phoneHome ?? record.phoneBusiness,
    birthday: record.birthday,
    preferredLocale: record.preferredLocale,
    postalCode: record.postalCode,
    preferredStore: record.preferredStore,
    addresses: record.addresses?.map((address) => toResponseAddress(address)),
  };
}

export function toResponseAddress(address: SfccAddressRecord, id?: string): CustomerAddress {
  const fullName = [address.firstName, address.lastName].filter(Boolean).join(' ');

  return {
    id,
    addressId: address.addressId ?? '',
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    stateCode: address.stateCode,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    firstName: address.firstName,
    lastName: address.lastName,
    fullName: fullName.length > 0 ? fullName : undefined,
    phone: address.phone,
    preferred: address.preferred,
  };
}
