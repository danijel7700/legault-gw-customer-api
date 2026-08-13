export const EXTERNAL_ID_TYPES = {
  SFCC: {
    CUSTOMER_ID: 'customerId',
    CUSTOMER_NO: 'customerNo',
  },
  SFSC: {
    ACCOUNT_ID: 'accountId',
    PERSON_CONTACT_ID: 'personContactId',
  },
  NAV: {
    CONTACT_ID: 'contactId',
    ACCOUNT_ID: 'accountId',
    PLACEHOLDER_EMAIL: 'placeholderEmail',
  },
  SFMC: {
    CONTACT_KEY: 'contactKey',
  },
} as const;

type ExternalIdTypeMap = typeof EXTERNAL_ID_TYPES;

export type ExternalIdType = {
  [
    TSystem in keyof ExternalIdTypeMap
  ]: ExternalIdTypeMap[TSystem][keyof ExternalIdTypeMap[TSystem]];
}[keyof ExternalIdTypeMap];
