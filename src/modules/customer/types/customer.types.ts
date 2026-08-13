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

/**
 * Everything SFCC knows about a customer, as the provider reports it.
 *
 * This is what provisioning writes from, so it keeps the identifiers the public
 * contract omits and the phones SFCC records separately. The `c_*` attributes
 * arrive renamed, so no SFCC-instance naming survives past the provider.
 *
 * Not a response shape — `CustomerProfile` is what the endpoint returns.
 */
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

/**
 * What `GET /v1/member/profile` returns.
 *
 * Answered from our own database once the customer has been provisioned, so it
 * carries no `paymentInstruments`: card data is deliberately not stored, and a
 * field that only appeared on a cache miss would be worse than no field at all.
 */
export interface CustomerProfile {
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly phone?: string;
  readonly birthday?: string;
  readonly preferredLocale?: string;
  readonly addresses?: readonly CustomerAddress[];
}

export interface CustomerIdentity {
  readonly customerId: string;
  readonly accessToken: string;
}
