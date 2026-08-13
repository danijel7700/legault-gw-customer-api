import type {
  SfccAddressRecord,
  SfccCustomerRecord,
} from '../../../modules/customer/types/customer.types.js';
import type { CustomerAddressResponse, GetCustomerResponse } from '../types/customers.types.js';

/**
 * SCAPI payload -> what the provider reports.
 *
 * Built field by field, never spread: a `...response` here would forward
 * `hashedLogin`, `authType`, the login timestamps and the five remaining `c_*`
 * attributes straight past the boundary. Only the three custom attributes Core
 * actually stores are mapped, and they are renamed on the way out.
 */
export function toSfccCustomerRecord(response: GetCustomerResponse): SfccCustomerRecord {
  return {
    customerId: response.customerId,
    customerNo: response.customerNo,
    login: response.login,

    email: response.email,
    firstName: response.firstName,
    lastName: response.lastName,
    // Kept separate — the store has a column for each. Collapsing to one field
    // is a presentation concern and happens at the response mapper.
    phoneHome: response.phoneHome,
    phoneMobile: response.phoneMobile,
    phoneBusiness: response.phoneBusiness,
    birthday: response.birthday,
    preferredLocale: response.preferredLocale,
    preferredStore: response.c_preferredStore,

    sfscAccountId: response.c_sscid,
    sfscPersonContactId: response.c_ssccid,

    addresses: response.addresses?.map(toSfccAddressRecord),
  };
}

function toSfccAddressRecord(address: CustomerAddressResponse): SfccAddressRecord {
  return {
    // Deliberately not coerced to '' — see SfccAddressRecord.
    addressId: address.addressId,
    firstName: address.firstName,
    lastName: address.lastName,
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    stateCode: address.stateCode,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    phone: address.phone,
    phoneType: address.c_phoneType,
    preferred: address.preferred,
  };
}
