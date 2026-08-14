import type {
  SfccAddressRecord,
  SfccCustomerRecord,
  SfccCustomerUpdate,
} from '../../../modules/customer/types/customer.types.js';
import type { Mutable } from '../../../shared/types/utility.types.js';
import type {
  CustomerAddressResponse,
  GetCustomerResponse,
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
