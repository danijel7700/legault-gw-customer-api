export interface CustomerAddressResponse {
  readonly addressId?: string;
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

export interface PaymentCardResponse {
  readonly cardType?: string;
  readonly maskedNumber?: string;
  readonly numberLastDigits?: string;
  readonly expirationMonth?: number;
  readonly expirationYear?: number;
  readonly holder?: string;
  readonly creditCardExpired?: boolean;
}

export interface PaymentInstrumentResponse {
  readonly paymentInstrumentId?: string;
  readonly paymentMethodId?: string;
  readonly default?: boolean;
  readonly paymentCard?: PaymentCardResponse;
}

export interface GetCustomerResponse {
  readonly customerId: string;
  readonly customerNo?: string;
  readonly login?: string;
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly phoneMobile?: string;
  readonly phoneHome?: string;
  readonly phoneBusiness?: string;
  readonly birthday?: string;
  readonly preferredLocale?: string;
  readonly addresses?: readonly CustomerAddressResponse[];
  readonly paymentInstruments?: readonly PaymentInstrumentResponse[];
}
