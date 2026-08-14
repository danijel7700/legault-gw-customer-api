import type { AxiosInstance } from 'axios';

import type { BrandConfig } from '../../../config/types/brand.types.js';
import { ErrorCode } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/logger/logger.js';
import {
  ADDRESS_ALREADY_EXISTS_SLUGS,
  CONCURRENT_MODIFICATION_SLUGS,
  CUSTOMER_NOT_FOUND_SLUGS,
  INVALID_CUSTOMER_ID_SLUGS,
} from '../constants/customers.constant.js';
import { CustomerError } from '../errors/customer.error.js';
import { SfccRequestError } from '../errors/sfcc-request.error.js';
import { createSfccHttpClient } from '../http/sfcc-http.js';
import type {
  CreateAddressRequest,
  CustomerAddressResponse,
  GetCustomerResponse,
  UpdateAddressRequest,
  UpdateCustomerRequest,
} from '../types/customers.types.js';
import type { SfccUpstreamInfo } from '../types/sfcc-http.types.js';
import { problemSlug } from '../utils/problem-slug.util.js';

export interface CustomersClient {
  getCustomer(accessToken: string, customerId: string): Promise<GetCustomerResponse>;
  updateCustomer(
    accessToken: string,
    customerId: string,
    body: UpdateCustomerRequest,
  ): Promise<GetCustomerResponse>;
  createAddress(
    accessToken: string,
    customerId: string,
    body: CreateAddressRequest,
  ): Promise<CustomerAddressResponse>;
  updateAddress(
    accessToken: string,
    customerId: string,
    addressName: string,
    body: UpdateAddressRequest,
  ): Promise<CustomerAddressResponse>;
  deleteAddress(accessToken: string, customerId: string, addressName: string): Promise<void>;
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
    createAddress: (accessToken, customerId, body) =>
      createAddress(http, brandConfig, accessToken, customerId, body),
    updateAddress: (accessToken, customerId, addressName, body) =>
      updateAddress(http, brandConfig, accessToken, customerId, addressName, body),
    deleteAddress: (accessToken, customerId, addressName) =>
      deleteAddress(http, brandConfig, accessToken, customerId, addressName),
  };
}

function requestConfig(
  brandConfig: BrandConfig,
  accessToken: string,
  json = false,
): { headers: Record<string, string>; params: Record<string, string> } {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };

  if (json) {
    headers['Content-Type'] = 'application/json';
  }

  return { headers, params: { siteId: brandConfig.siteId } };
}

function addressPath(customerId: string, addressName?: string): string {
  const base = `/customers/${encodeURIComponent(customerId)}/addresses`;

  return addressName === undefined ? base : `${base}/${encodeURIComponent(addressName)}`;
}

async function getCustomer(
  http: AxiosInstance,
  brandConfig: BrandConfig,
  accessToken: string,
  customerId: string,
): Promise<GetCustomerResponse> {
  const response = await http
    .get<GetCustomerResponse>(
      `/customers/${encodeURIComponent(customerId)}`,
      requestConfig(brandConfig, accessToken),
    )
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
  return retryOnceOnConcurrentModification(
    async () => {
      const response = await http.patch<GetCustomerResponse>(
        `/customers/${encodeURIComponent(customerId)}`,
        body,
        requestConfig(brandConfig, accessToken, true),
      );

      requireCustomerId(response.data);

      return response.data;
    },
    mapUpdateCustomerError,
    { customerId },
  );
}

async function createAddress(
  http: AxiosInstance,
  brandConfig: BrandConfig,
  accessToken: string,
  customerId: string,
  body: CreateAddressRequest,
): Promise<CustomerAddressResponse> {
  const response = await http
    .post<CustomerAddressResponse>(
      addressPath(customerId),
      body,
      requestConfig(brandConfig, accessToken, true),
    )
    .catch((error: unknown) => {
      throw mapAddressError(error);
    });

  return response.data;
}

async function updateAddress(
  http: AxiosInstance,
  brandConfig: BrandConfig,
  accessToken: string,
  customerId: string,
  addressName: string,
  body: UpdateAddressRequest,
): Promise<CustomerAddressResponse> {
  return retryOnceOnConcurrentModification(
    async () => {
      const response = await http.patch<CustomerAddressResponse>(
        addressPath(customerId, addressName),
        body,
        requestConfig(brandConfig, accessToken, true),
      );

      return response.data;
    },
    mapAddressError,
    { customerId, addressName },
  );
}

async function deleteAddress(
  http: AxiosInstance,
  brandConfig: BrandConfig,
  accessToken: string,
  customerId: string,
  addressName: string,
): Promise<void> {
  await http
    .delete(addressPath(customerId, addressName), requestConfig(brandConfig, accessToken))
    .catch((error: unknown) => {
      if (isAddressGone(error)) {
        logger.debug({ customerId, addressName }, 'SFCC no longer holds the address');

        return;
      }

      throw mapAddressError(error);
    });
}

async function retryOnceOnConcurrentModification<T>(
  send: () => Promise<T>,
  mapError: (error: unknown) => unknown,
  context: { customerId: string; addressName?: string },
): Promise<T> {
  try {
    return await send();
  } catch (error: unknown) {
    if (!isConcurrentModification(error)) {
      throw mapError(error);
    }

    logger.debug(context, 'SFCC reported a concurrent modification, retrying the write once');

    return send().catch((retryError: unknown) => {
      throw mapError(retryError);
    });
  }
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
  if (!(error instanceof SfccRequestError) || isRenameConflict(error)) {
    return false;
  }

  const slug = problemSlug(error.upstreamBody);

  return (
    error.upstreamStatus === 409 || (slug !== undefined && CONCURRENT_MODIFICATION_SLUGS.has(slug))
  );
}

function isRenameConflict(error: unknown): boolean {
  if (!(error instanceof SfccRequestError)) {
    return false;
  }

  const slug = problemSlug(error.upstreamBody);

  return slug !== undefined && ADDRESS_ALREADY_EXISTS_SLUGS.has(slug);
}

function isAddressGone(error: unknown): boolean {
  if (!(error instanceof SfccRequestError)) {
    return false;
  }

  const slug = problemSlug(error.upstreamBody);

  return error.upstreamStatus === 404 || (slug !== undefined && CUSTOMER_NOT_FOUND_SLUGS.has(slug));
}

function mapAddressError(error: unknown): unknown {
  if (error instanceof SfccRequestError && isRenameConflict(error)) {
    return new CustomerError(
      409,
      'An address with that name already exists',
      ErrorCode.CONFLICT,
      upstreamOf(error),
    );
  }

  return mapUpdateCustomerError(error);
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
