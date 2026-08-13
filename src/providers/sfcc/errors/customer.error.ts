import { HttpError, type ErrorCodeValue } from '../../../shared/errors/index.js';
import type { SfccUpstreamInfo } from '../types/sfcc-http.types.js';

export class CustomerError extends HttpError {
  readonly upstreamStatus: number | undefined;
  readonly upstreamCode: string | undefined;
  readonly upstreamBody: string | undefined;

  constructor(
    statusCode: number,
    message: string,
    code: ErrorCodeValue,
    upstream: SfccUpstreamInfo,
  ) {
    super(statusCode, message, { code });

    this.upstreamStatus = upstream.upstreamStatus;
    this.upstreamCode = upstream.upstreamCode;
    this.upstreamBody = upstream.upstreamBody;
  }
}
