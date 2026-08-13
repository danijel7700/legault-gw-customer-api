import axios, { type AxiosInstance } from 'axios';

import type { BrandConfig } from '../../../config/types/brand.types.js';
import { DEFAULT_TIMEOUT_MS } from '../constants/sfcc-http.constant.js';
import { SfccRequestError } from '../errors/sfcc-request.error.js';
import type { SfccHttpOptions } from '../types/sfcc-http.types.js';
import { summariseBody } from '../utils/scrub-sensitive.util.js';

export function createSfccHttpClient(
  brandConfig: BrandConfig,
  options: SfccHttpOptions = {},
): AxiosInstance {
  const instance = axios.create({
    baseURL: options.baseUrl ?? brandConfig.scapiBaseUrl,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
  });

  instance.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      throw toSfccRequestError(error);
    },
  );

  return instance;
}

function toSfccRequestError(error: unknown): SfccRequestError {
  if (error instanceof SfccRequestError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    return new SfccRequestError('SFCC request failed', {
      upstreamStatus: error.response?.status,
      upstreamCode: error.code,
      upstreamBody: summariseBody(error.response?.data),
    });
  }

  return new SfccRequestError('SFCC request failed');
}
