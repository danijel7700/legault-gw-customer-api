import { logger } from '../../../shared/logger/logger.js';
import type { SlasClient } from '../clients/slas.client.js';

import { upstreamStatusOf } from './upstream-status.util.js';

export async function withGuestToken<T>(
  slas: SlasClient,
  run: (accessToken: string) => Promise<T>,
): Promise<T> {
  const accessToken = await slas.getGuestToken();

  try {
    return await run(accessToken);
  } catch (error: unknown) {
    if (upstreamStatusOf(error) !== 401) {
      throw error;
    }

    logger.debug('SFCC rejected the cached guest token; refreshing it and retrying once');

    return run(await slas.getGuestToken({ forceRefresh: true }));
  }
}
