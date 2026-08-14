import type {
  Customer,
  CustomerAddress as StoredAddress,
} from '../../../database/schemas/customer/index.js';
import type { CustomerAddress, CustomerProfile } from '../types/customer.types.js';

export function toCustomerProfile(customer: Customer): CustomerProfile {
  const { profile } = customer;

  return {
    email: profile.email ?? undefined,
    firstName: profile.firstName ?? undefined,
    lastName: profile.lastName ?? undefined,
    phone: profile.phoneMobile ?? profile.phoneHome ?? undefined,
    birthday: profile.birthDate ?? undefined,
    preferredLocale: profile.language ?? undefined,
    postalCode: profile.postalCode ?? undefined,
    preferredStore: profile.preferredStore ?? undefined,
    addresses: customer.addresses.map(toResponseAddress),
  };
}

export function toResponseAddress(address: StoredAddress): CustomerAddress {
  const fullName = [address.firstName, address.lastName].filter(Boolean).join(' ');

  return {
    id: address.id,
    addressId: address.sfccAddressId ?? '',
    address1: address.street1 ?? undefined,
    address2: address.street2 ?? undefined,
    city: address.city ?? undefined,
    stateCode: address.stateCode ?? undefined,
    postalCode: address.postalCode ?? undefined,
    countryCode: address.countryCode ?? undefined,
    firstName: address.firstName ?? undefined,
    lastName: address.lastName ?? undefined,
    fullName: fullName.length > 0 ? fullName : undefined,
    phone: address.phone ?? undefined,
    preferred: address.isPreferred,
  };
}
