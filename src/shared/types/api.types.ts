import type { API_VERSIONS, BRANDS } from '../constants/api.constant.js';

export type ApiVersion = (typeof API_VERSIONS)[number];

export type Brand = (typeof BRANDS)[number];

export interface VersionedParams {
  version: ApiVersion;

  [key: string]: string | string[];
  [key: number]: string;
}
