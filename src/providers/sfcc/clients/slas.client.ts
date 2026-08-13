import type { AxiosInstance } from 'axios';

import type { BrandConfig } from '../../../config/types/brand.types.js';
import { logger } from '../../../shared/logger/logger.js';
import {
  CLIENT_AUTH_FAILURE,
  GUEST_TOKEN_TTL_FALLBACK_S,
  TOKEN_EXPIRY_SKEW_MS,
} from '../constants/slas.constant.js';
import { SfccRequestError } from '../errors/sfcc-request.error.js';
import { createSfccHttpClient } from '../http/sfcc-http.js';
import { basicAuthHeader } from '../utils/basic-auth.util.js';
import type { SlasGuestTokenRequest, SlasGuestTokenResponse } from '../types/slas.types.js';

interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface GuestTokenOptions {
  readonly forceRefresh?: boolean;
}

export interface SlasClient {
  getGuestToken(options?: GuestTokenOptions): Promise<string>;
}

export function createSlasClient(brandConfig: BrandConfig): SlasClient {
  const http = createSfccHttpClient(brandConfig, { baseUrl: brandConfig.slasBaseUrl });

  let cached: CachedToken | undefined;
  let inFlight: Promise<CachedToken> | undefined;

  const fetchToken = async (): Promise<CachedToken> => {
    inFlight ??= requestGuestToken(http, brandConfig);

    try {
      const fresh = await inFlight;
      cached = fresh;

      return fresh;
    } finally {
      inFlight = undefined;
    }
  };

  return {
    getGuestToken: async (options: GuestTokenOptions = {}): Promise<string> => {
      if (options.forceRefresh === true) {
        cached = undefined;
        inFlight = undefined;
      } else if (cached !== undefined && Date.now() < cached.expiresAtMs) {
        return cached.token;
      }

      return (await fetchToken()).token;
    },
  };
}

async function requestGuestToken(
  http: AxiosInstance,
  brandConfig: BrandConfig,
): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    channel_id: brandConfig.siteId,
  } satisfies Record<keyof SlasGuestTokenRequest, string>);

  const response = await http
    .post<SlasGuestTokenResponse>('/token', body, {
      headers: {
        Authorization: basicAuthHeader(brandConfig.clientId, brandConfig.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    .catch((error: unknown) => {
      throw mapGuestTokenError(error);
    });

  const token = response.data.access_token;

  if (typeof token !== 'string' || token.length === 0) {
    throw new SfccRequestError('SLAS guest token response contained no access_token');
  }

  const ttlMs = (response.data.expires_in ?? GUEST_TOKEN_TTL_FALLBACK_S) * 1_000;

  logger.debug(
    { brand: brandConfig.brand, expiresInS: response.data.expires_in },
    'Fetched a new SLAS guest token',
  );

  return { token, expiresAtMs: Date.now() + Math.max(ttlMs - TOKEN_EXPIRY_SKEW_MS, 0) };
}

function mapGuestTokenError(error: unknown): unknown {
  if (!(error instanceof SfccRequestError)) {
    return error;
  }

  if (error.upstreamStatus === 401 || CLIENT_AUTH_FAILURE.test(error.upstreamBody ?? '')) {
    return new SfccRequestError('SLAS rejected this service’s client credentials', {
      upstreamStatus: error.upstreamStatus,
      upstreamCode: error.upstreamCode,
      upstreamBody: error.upstreamBody,
    });
  }

  return error;
}
