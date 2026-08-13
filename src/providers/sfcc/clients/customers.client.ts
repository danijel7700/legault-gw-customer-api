import type { AxiosInstance } from 'axios';

import type { BrandConfig } from '../../../config/types/brand.types.js';
import { ErrorCode } from '../../../shared/errors/index.js';
import {
  CUSTOMER_NOT_FOUND_SLUGS,
  INVALID_CUSTOMER_ID_SLUGS,
} from '../constants/customers.constant.js';
import { CustomerError } from '../errors/customer.error.js';
import { SfccRequestError } from '../errors/sfcc-request.error.js';
import { createSfccHttpClient } from '../http/sfcc-http.js';
import type { GetCustomerResponse } from '../types/customers.types.js';
import { problemSlug } from '../utils/problem-slug.util.js';

export interface CustomersClient {
  getCustomer(accessToken: string, customerId: string): Promise<GetCustomerResponse>;
}

export function createCustomersClient(brandConfig: BrandConfig): CustomersClient {
  const http = createSfccHttpClient(brandConfig, {
    baseUrl: brandConfig.shopperCustomersBaseUrl,
  });

  return {
    getCustomer: (accessToken, customerId) =>
      getCustomer(http, brandConfig, accessToken, customerId),
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
      throw mapGetCustomerError(error);
    });

  if (typeof response.data.customerId !== 'string' || response.data.customerId.length === 0) {
    throw new SfccRequestError('SFCC customer response contained no customerId');
  }

  return response.data;
}

function mapGetCustomerError(error: unknown): unknown {
  if (!(error instanceof SfccRequestError)) {
    return error;
  }

  const upstream = {
    upstreamStatus: error.upstreamStatus,
    upstreamCode: error.upstreamCode,
    upstreamBody: error.upstreamBody,
  };
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
