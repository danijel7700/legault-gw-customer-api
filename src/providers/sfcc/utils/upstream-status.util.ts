/**
 * Reads the upstream HTTP status off any of the SFCC error classes without
 * importing them, so the token-retry seam does not have to know which mapper
 * produced the failure.
 */
export function upstreamStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('upstreamStatus' in error)) {
    return undefined;
  }

  const { upstreamStatus } = error;

  return typeof upstreamStatus === 'number' ? upstreamStatus : undefined;
}
