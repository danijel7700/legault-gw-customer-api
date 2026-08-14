import type {
  SfccAddressCreate,
  SfccAddressRecord,
  SfccAddressUpdate,
  SfccCustomerRecord,
  SfccCustomerUpdate,
} from '../../../modules/customer/types/customer.types.js';
import type { Mutable } from '../../../shared/types/utility.types.js';
import type {
  CreateAddressRequest,
  CustomerAddressResponse,
  GetCustomerResponse,
  UpdateAddressRequest,
  UpdateCustomerRequest,
} from '../types/customers.types.js';

const CLEAR_VALUE: string | null = null;

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

export function toSfccCustomerRecord(response: GetCustomerResponse): SfccCustomerRecord {
  return {
    customerId: response.customerId,
    customerNo: response.customerNo,
    login: response.login,

    email: response.email,
    firstName: emptyToUndefined(response.firstName),
    lastName: emptyToUndefined(response.lastName),
    phoneHome: emptyToUndefined(response.phoneHome),
    phoneMobile: emptyToUndefined(response.phoneMobile),
    phoneBusiness: emptyToUndefined(response.phoneBusiness),
    birthday: response.birthday,
    preferredLocale: response.preferredLocale,
    postalCode: emptyToUndefined(response.c_postalCode),
    preferredStore: emptyToUndefined(response.c_preferredStore),

    sfscAccountId: response.c_sscid,
    sfscPersonContactId: response.c_ssccid,

    addresses: response.addresses?.map(toSfccAddressRecord),
  };
}

export function toUpdateCustomerRequest(update: SfccCustomerUpdate): UpdateCustomerRequest {
  const body: Mutable<UpdateCustomerRequest> = {};

  if (update.firstName !== undefined) {
    body.firstName = update.firstName ?? CLEAR_VALUE;
  }
  if (update.lastName !== undefined) {
    body.lastName = update.lastName ?? CLEAR_VALUE;
  }
  if (update.phoneHome !== undefined) {
    body.phoneHome = update.phoneHome ?? CLEAR_VALUE;
  }
  if (update.phoneMobile !== undefined) {
    body.phoneMobile = update.phoneMobile ?? CLEAR_VALUE;
  }
  if (update.postalCode !== undefined) {
    body.c_postalCode = update.postalCode ?? CLEAR_VALUE;
  }
  if (update.preferredStore !== undefined) {
    body.c_preferredStore = update.preferredStore ?? CLEAR_VALUE;
  }

  return body;
}

export function toCreateAddressRequest(address: SfccAddressCreate): CreateAddressRequest {
  const body: Mutable<CreateAddressRequest> = {
    addressId: address.addressId,
    firstName: address.firstName,
    lastName: address.lastName,
    address1: address.street1,
    address2: address.street2 ?? CLEAR_VALUE,
    city: address.city,
    stateCode: address.stateCode,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    phone: address.phone,
  };

  if (address.phoneType !== undefined) {
    body.c_phoneType = address.phoneType;
  }

  return body;
}

export function toUpdateAddressRequest(update: SfccAddressUpdate): UpdateAddressRequest {
  const body: Mutable<UpdateAddressRequest> = {
    addressId: update.addressId,
    countryCode: update.countryCode,
    lastName: update.lastName,
  };

  if (update.firstName !== undefined) {
    body.firstName = update.firstName;
  }
  if (update.street1 !== undefined) {
    body.address1 = update.street1;
  }
  if (update.street2 !== undefined) {
    body.address2 = update.street2 ?? CLEAR_VALUE;
  }
  if (update.city !== undefined) {
    body.city = update.city;
  }
  if (update.stateCode !== undefined) {
    body.stateCode = update.stateCode;
  }
  if (update.postalCode !== undefined) {
    body.postalCode = update.postalCode;
  }
  if (update.phone !== undefined) {
    body.phone = update.phone;
  }
  if (update.phoneType !== undefined) {
    body.c_phoneType = update.phoneType ?? CLEAR_VALUE;
  }
  if (update.preferred !== undefined) {
    body.preferred = update.preferred;
  }

  return body;
}

export function toSfccAddressRecord(address: CustomerAddressResponse): SfccAddressRecord {
  return {
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
