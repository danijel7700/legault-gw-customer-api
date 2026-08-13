import { BRANDS } from '../shared/constants/api.constant.js';
import { BadRequestError, ErrorCode } from '../shared/errors/index.js';
import type { Brand } from '../shared/types/api.types.js';
import { isBrand } from '../shared/utils/api.util.js';

import { getBrandIdentifiers } from './constants/brand-identifiers.constant.js';
import { config } from './env.config.js';
import type {
  BrandConfig,
  BrandIdentifiers,
  LoggableBrandConfig,
  PublicBrandConfig,
} from './types/brand.types.js';

export function buildBrandUrls(
  identifiers: BrandIdentifiers,
): Pick<BrandConfig, 'scapiBaseUrl' | 'slasBaseUrl' | 'shopperCustomersBaseUrl'> {
  const scapiBaseUrl = `https://${identifiers.shortCode}.api.commercecloud.salesforce.com`;

  const slasBaseUrl = `${scapiBaseUrl}/shopper/auth/v1/organizations/${identifiers.orgId}/oauth2`;

  const shopperCustomersBaseUrl = `${scapiBaseUrl}/customer/shopper-customers/v1/organizations/${identifiers.orgId}`;

  return { scapiBaseUrl, slasBaseUrl, shopperCustomersBaseUrl };
}

let cache: Readonly<Record<Brand, BrandConfig>> | undefined;

function buildBrandConfigMap(): Readonly<Record<Brand, BrandConfig>> {
  const brandIdentifiers = getBrandIdentifiers();

  const entries = BRANDS.map((brand): readonly [Brand, BrandConfig] => {
    const identifiers = brandIdentifiers[brand];
    const loggable: LoggableBrandConfig = {
      brand,
      ...identifiers,
      ...buildBrandUrls(identifiers),
      redirectUri: config.sfcc[brand].redirectUri,
    };

    return [
      brand,
      Object.freeze({
        ...loggable,
        ...config.slas[brand],
        toJSON: () => loggable,
      }),
    ];
  });

  return Object.freeze(Object.fromEntries(entries) as Record<Brand, BrandConfig>);
}

export function getBrandConfigMap(): Readonly<Record<Brand, BrandConfig>> {
  cache ??= buildBrandConfigMap();

  return cache;
}

export function getBrandConfig(brand: string): BrandConfig {
  if (!isBrand(brand)) {
    throw new BadRequestError(`Unknown brand '${brand}'. Supported brands: ${BRANDS.join(', ')}.`, {
      code: ErrorCode.UNKNOWN_BRAND,
    });
  }

  return getBrandConfigMap()[brand];
}

export function toPublicBrandConfig(brandConfig: BrandConfig): PublicBrandConfig {
  return {
    shortCode: brandConfig.shortCode,
    orgId: brandConfig.orgId,
    siteId: brandConfig.siteId,
  };
}
