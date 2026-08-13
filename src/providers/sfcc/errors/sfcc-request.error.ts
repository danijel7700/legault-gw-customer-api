import { UpstreamError } from '../../../shared/errors/index.js';
import type { SfccUpstreamInfo } from '../types/sfcc-http.types.js';

export class SfccRequestError extends UpstreamError {
  readonly upstreamStatus: number | undefined;
  readonly upstreamCode: string | undefined;
  readonly upstreamBody: string | undefined;

  constructor(message: string, info: SfccUpstreamInfo = {}) {
    super(message);

    this.upstreamStatus = info.upstreamStatus;
    this.upstreamCode = info.upstreamCode;
    this.upstreamBody = info.upstreamBody;
  }
}
