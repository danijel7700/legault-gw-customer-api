import type { Logger } from 'pino';

export interface RequestContext {
  readonly requestId: string;
  readonly log: Logger;
  readonly receivedAt: number;
}
