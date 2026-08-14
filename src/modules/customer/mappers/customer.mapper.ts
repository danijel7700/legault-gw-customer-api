import type {
  Customer,
  CustomerAddress,
  CustomerAddressRow,
  CustomerExternalIdRow,
  CustomerRow,
  ExternalId,
  ExternalIdType,
} from '../../../database/schemas/customer/index.js';

export interface CustomerAggregateRow extends CustomerRow {
  readonly externalIds: readonly CustomerExternalIdRow[];
  readonly addresses: readonly CustomerAddressRow[];
}

export function toCustomer(row: CustomerAggregateRow): Customer {
  return {
    id: row.id,
    brand: row.brand,
    externalIds: row.externalIds.map(toExternalId),
    addresses: row.addresses.map(toCustomerAddress),
    profile: {
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      salutation: row.salutation,
      gender: row.gender,
      birthDate: row.birthDate,
      language: row.language,
      phoneHome: row.phoneHome,
      phoneMobile: row.phoneMobile,
      postalCode: row.postalCode,
      preferredStore: row.preferredStore,
    },
    metadata: {
      source: row.source,
      lastModifiedBy: row.lastModifiedBy,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

export function toExternalId(row: CustomerExternalIdRow): ExternalId {
  return {
    id: row.id,
    customerId: row.customerId,
    brand: row.brand,
    system: row.system,
    idType: row.idType as ExternalIdType,
    value: row.value,
    createdAt: row.createdAt,
  };
}

export function toCustomerAddress(row: CustomerAddressRow): CustomerAddress {
  return {
    id: row.id,
    customerId: row.customerId,
    brand: row.brand,
    sfccAddressId: row.sfccAddressId,
    firstName: row.firstName,
    lastName: row.lastName,
    street1: row.street1,
    street2: row.street2,
    city: row.city,
    stateCode: row.stateCode,
    postalCode: row.postalCode,
    countryCode: row.countryCode,
    phone: row.phone,
    phoneType: row.phoneType,
    isPreferred: row.isPreferred,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
