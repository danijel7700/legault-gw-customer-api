/**
 * The address shape SFCC reports, before anything is stored.
 *
 * `addressId` stays optional here rather than being coerced to `''`: an empty
 * string in `sfcc_address_id` would defeat `customer_address_sfcc_id_uq`, whose
 * predicate is `WHERE sfcc_address_id IS NOT NULL`, by colliding every
 * unidentified address on `('', customerId)`.
 */
export interface SfccAddressRecord {
  readonly addressId?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly address1?: string;
  readonly address2?: string;
  readonly city?: string;
  readonly stateCode?: string;
  readonly postalCode?: string;
  readonly countryCode?: string;
  readonly phone?: string;
  readonly phoneType?: string;
  readonly preferred?: boolean;
}

export interface SfccCustomerRecord {
  readonly customerId: string;
  readonly customerNo?: string;
  readonly login?: string;

  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly phoneHome?: string;
  readonly phoneMobile?: string;
  readonly phoneBusiness?: string;
  readonly birthday?: string;
  readonly preferredLocale?: string;
  readonly postalCode?: string;
  readonly preferredStore?: string;

  /** SFSC Account id, from `c_sscid`. Mondou in practice. */
  readonly sfscAccountId?: string;
  /** SFSC PersonContact id, from `c_ssccid`. Mondou in practice. */
  readonly sfscPersonContactId?: string;

  readonly addresses?: readonly SfccAddressRecord[];
}

export interface CustomerAddress {
  readonly addressId: string;
  readonly address1?: string;
  readonly address2?: string;
  readonly city?: string;
  readonly stateCode?: string;
  readonly postalCode?: string;
  readonly countryCode?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly fullName?: string;
  readonly phone?: string;
  readonly preferred?: boolean;
}

export interface CustomerProfile {
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly phone?: string;
  readonly birthday?: string;
  readonly preferredLocale?: string;
  readonly postalCode?: string;
  readonly preferredStore?: string;
  readonly addresses?: readonly CustomerAddress[];
}

export interface CustomerIdentity {
  readonly customerId: string;
  readonly accessToken: string;
}

export const PHONE_TYPES = ['mobile', 'home'] as const;

export type PhoneType = (typeof PHONE_TYPES)[number];

export interface UpdateMemberProfileRequest {
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly phone?: string | null;
  readonly phoneType?: PhoneType;
  readonly postalCode?: string | null;
  readonly preferredStore?: string | null;
}

export interface SfccCustomerUpdate {
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly phoneHome?: string | null;
  readonly phoneMobile?: string | null;
  readonly postalCode?: string | null;
  readonly preferredStore?: string | null;
}
