import type { Brand } from '../enums/index.js';

export interface CustomerAddress {
  readonly id: string;
  readonly customerId: string;
  readonly brand: Brand;
  readonly sfccAddressId: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly street1: string | null;
  readonly street2: string | null;
  readonly city: string | null;
  readonly stateCode: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly phone: string | null;
  readonly phoneType: string | null;
  readonly isPreferred: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
