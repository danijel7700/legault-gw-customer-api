import { API_VERSIONS, BRANDS } from '../constants/api.constant.js';
import type { ApiVersion, Brand } from '../types/api.types.js';

export function isApiVersion(value: string): value is ApiVersion {
  return (API_VERSIONS as readonly string[]).includes(value);
}

export function isBrand(value: string): value is Brand {
  return (BRANDS as readonly string[]).includes(value);
}
