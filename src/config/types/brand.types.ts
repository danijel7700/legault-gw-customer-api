import type { Brand } from '../../shared/types/api.types.js';

export interface BrandConfig {
  readonly brand: Brand;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly shortCode: string;
  readonly orgId: string;
  readonly siteId: string;
  readonly scapiBaseUrl: string;
  readonly slasBaseUrl: string;
  readonly shopperCustomersBaseUrl: string;
  readonly redirectUri: string;

  toJSON(): LoggableBrandConfig;
}

export type LoggableBrandConfig = Omit<BrandConfig, 'clientId' | 'clientSecret' | 'toJSON'>;

export type PublicBrandConfig = Pick<BrandConfig, 'shortCode' | 'orgId' | 'siteId'>;

export type BrandIdentifiers = Pick<BrandConfig, 'shortCode' | 'orgId' | 'siteId'>;
