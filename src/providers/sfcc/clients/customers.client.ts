import type { AxiosInstance } from 'axios';

import type { BrandConfig } from '../../../config/types/brand.types.js';
import { ErrorCode } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/logger/logger.js';
import {
  CONCURRENT_MODIFICATION_SLUGS,
  CUSTOMER_NOT_FOUND_SLUGS,
  INVALID_CUSTOMER_ID_SLUGS,
} from '../constants/customers.constant.js';
import { CustomerError } from '../errors/customer.error.js';
import { SfccRequestError } from '../errors/sfcc-request.error.js';
import { createSfccHttpClient } from '../http/sfcc-http.js';
import type { GetCustomerResponse, UpdateCustomerRequest } from '../types/customers.types.js';
import type { SfccUpstreamInfo } from '../types/sfcc-http.types.js';
import { problemSlug } from '../utils/problem-slug.util.js';

export interface CustomersClient {
  getCustomer(accessToken: string, customerId: string): Promise<GetCustomerResponse>;
  updateCustomer(
    accessToken: string,
    customerId: string,
    body: UpdateCustomerRequest,
  ): Promise<GetCustomerResponse>;
}

export function createCustomersClient(brandConfig: BrandConfig): CustomersClient {
  const http = createSfccHttpClient(brandConfig, {
    baseUrl: brandConfig.shopperCustomersBaseUrl,
  });

  return {
    getCustomer: (accessToken, customerId) =>
      getCustomer(http, brandConfig, accessToken, customerId),
    updateCustomer: (accessToken, customerId, body) =>
      updateCustomer(http, brandConfig, accessToken, customerId, body),
  };
}

async function getCustomer(
  http: AxiosInstance,
  brandConfig: BrandConfig,
  accessToken: string,
  customerId: string,
): Promise<GetCustomerResponse> {
  const response = await http
    .get<GetCustomerResponse>(`/customers/${encodeURIComponent(customerId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { siteId: brandConfig.siteId },
    })
    .catch((error: unknown) => {
      throw mapCustomerError(error);
    });

  requireCustomerId(response.data);

  return response.data;
}

async function updateCustomer(
  http: AxiosInstance,
  brandConfig: BrandConfig,
  accessToken: string,
  customerId: string,
  body: UpdateCustomerRequest,
): Promise<GetCustomerResponse> {
  try {
    return await sendUpdate(http, brandConfig, accessToken, customerId, body);
  } catch (error: unknown) {
    if (!isConcurrentModification(error)) {
      throw mapCustomerError(error);
    }

    logger.debug(
      { customerId },
      'SFCC reported a concurrent modification, retrying the patch once',
    );

    return sendUpdate(http, brandConfig, accessToken, customerId, body).catch(
      (retryError: unknown) => {
        throw mapUpdateCustomerError(retryError);
      },
    );
  }
}

async function sendUpdate(
  http: AxiosInstance,
  brandConfig: BrandConfig,
  accessToken: string,
  customerId: string,
  body: UpdateCustomerRequest,
): Promise<GetCustomerResponse> {
  const response = await http.patch<GetCustomerResponse>(
    `/customers/${encodeURIComponent(customerId)}`,
    body,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      params: { siteId: brandConfig.siteId },
    },
  );

  requireCustomerId(response.data);

  return response.data;
}

function requireCustomerId(data: GetCustomerResponse): void {
  if (typeof data.customerId !== 'string' || data.customerId.length === 0) {
    throw new SfccRequestError('SFCC customer response contained no customerId');
  }
}

function upstreamOf(error: SfccRequestError): SfccUpstreamInfo {
  return {
    upstreamStatus: error.upstreamStatus,
    upstreamCode: error.upstreamCode,
    upstreamBody: error.upstreamBody,
  };
}

function isConcurrentModification(error: unknown): boolean {
  if (!(error instanceof SfccRequestError)) {
    return false;
  }

  const slug = problemSlug(error.upstreamBody);

  return (
    error.upstreamStatus === 409 || (slug !== undefined && CONCURRENT_MODIFICATION_SLUGS.has(slug))
  );
}

function mapCustomerError(error: unknown): unknown {
  if (!(error instanceof SfccRequestError)) {
    return error;
  }

  const upstream = upstreamOf(error);
  const slug = problemSlug(error.upstreamBody);

  if (error.upstreamStatus === 404 || (slug !== undefined && CUSTOMER_NOT_FOUND_SLUGS.has(slug))) {
    return new CustomerError(
      404,
      'Customer profile not found',
      ErrorCode.CUSTOMER_NOT_FOUND,
      upstream,
    );
  }

  if (error.upstreamStatus === 401) {
    return new CustomerError(
      401,
      'The shopper access token is expired or invalid',
      ErrorCode.UNAUTHORIZED,
      upstream,
    );
  }

  if (error.upstreamStatus === 403) {
    return new CustomerError(
      403,
      'SFCC refused this request for the customer profile',
      ErrorCode.SFCC_ACCESS_DENIED,
      upstream,
    );
  }

  if (error.upstreamStatus === 400 || (slug !== undefined && INVALID_CUSTOMER_ID_SLUGS.has(slug))) {
    return new CustomerError(400, 'Customer id is not valid', ErrorCode.BAD_REQUEST, upstream);
  }

  return error;
}

function mapUpdateCustomerError(error: unknown): unknown {
  if (error instanceof SfccRequestError && isConcurrentModification(error)) {
    return new CustomerError(
      409,
      'The customer profile was modified concurrently, please retry',
      ErrorCode.CONFLICT,
      upstreamOf(error),
    );
  }

  return mapCustomerError(error);
}
