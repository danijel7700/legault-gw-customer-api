import type { Brand } from '../../shared/types/api.types.js';
import { config } from '../env.config.js';
import type { BrandIdentifiers } from '../types/brand.types.js';

export function getBrandIdentifiers(): Readonly<Record<Brand, BrandIdentifiers>> {
  return Object.freeze({
    rens: Object.freeze({
      shortCode: config.sfcc.rens.shortCode,
      orgId: config.sfcc.rens.orgId,
      siteId: config.sfcc.rens.siteId,
    }),
    mondou: Object.freeze({
      shortCode: config.sfcc.mondou.shortCode,
      orgId: config.sfcc.mondou.orgId,
      siteId: config.sfcc.mondou.siteId,
    }),
  });
}
