import type { PublicBrandConfig } from '../../../config/types/brand.types.js';
import type { ApiVersion, Brand } from '../../../shared/types/api.types.js';

export interface HealthResponse {
  status: 'ok';
  version: ApiVersion;
  brand: Brand;
  sfcc: PublicBrandConfig;
  timestamp: string;
}

export interface LivenessResponse {
  status: 'ok';
  uptime: number;
}

export interface ReadinessResponse {
  status: 'ok';
  database: 'up';
}
