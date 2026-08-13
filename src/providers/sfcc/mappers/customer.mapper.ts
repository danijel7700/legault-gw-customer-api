import type {
  CustomerAddress,
  CustomerPaymentCard,
  CustomerPaymentInstrument,
  CustomerProfile,
} from '../../../modules/customer/types/customer.types.js';
import type {
  CustomerAddressResponse,
  GetCustomerResponse,
  PaymentCardResponse,
  PaymentInstrumentResponse,
} from '../types/customers.types.js';

export function toCustomerProfile(response: GetCustomerResponse): CustomerProfile {
  return {
    email: response.email,
    firstName: response.firstName,
    lastName: response.lastName,
    phone: response.phoneMobile ?? response.phoneHome ?? response.phoneBusiness,
    birthday: response.birthday,
    preferredLocale: response.preferredLocale,
    addresses: response.addresses?.map(toCustomerAddress),
    paymentInstruments: response.paymentInstruments?.map(toPaymentInstrument),
  };
}

function toCustomerAddress(address: CustomerAddressResponse): CustomerAddress {
  return {
    addressId: address.addressId ?? '',
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    stateCode: address.stateCode,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    firstName: address.firstName,
    lastName: address.lastName,
    fullName: address.fullName,
    phone: address.phone,
    preferred: address.preferred,
  };
}

function toPaymentInstrument(instrument: PaymentInstrumentResponse): CustomerPaymentInstrument {
  return {
    paymentInstrumentId: instrument.paymentInstrumentId ?? '',
    paymentMethodId: instrument.paymentMethodId,
    default: instrument.default,
    paymentCard:
      instrument.paymentCard === undefined ? undefined : toPaymentCard(instrument.paymentCard),
  };
}

function toPaymentCard(card: PaymentCardResponse): CustomerPaymentCard {
  return {
    cardType: card.cardType,
    maskedNumber: card.maskedNumber,
    numberLastDigits: card.numberLastDigits,
    expirationMonth: card.expirationMonth,
    expirationYear: card.expirationYear,
    holder: card.holder,
    creditCardExpired: card.creditCardExpired,
  };
}
