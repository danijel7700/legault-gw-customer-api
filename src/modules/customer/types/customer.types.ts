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

export interface CustomerPaymentCard {
  readonly cardType?: string;
  readonly maskedNumber?: string;
  readonly numberLastDigits?: string;
  readonly expirationMonth?: number;
  readonly expirationYear?: number;
  readonly holder?: string;
  readonly creditCardExpired?: boolean;
}

export interface CustomerPaymentInstrument {
  readonly paymentInstrumentId: string;
  readonly paymentMethodId?: string;
  readonly default?: boolean;
  readonly paymentCard?: CustomerPaymentCard;
}

export interface CustomerProfile {
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly phone?: string;
  readonly birthday?: string;
  readonly preferredLocale?: string;
  readonly addresses?: readonly CustomerAddress[];
  readonly paymentInstruments?: readonly CustomerPaymentInstrument[];
}

export interface CustomerIdentity {
  readonly customerId: string;
  readonly accessToken: string;
}
