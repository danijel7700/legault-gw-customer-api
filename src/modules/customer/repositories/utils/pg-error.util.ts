const UNIQUE_VIOLATION = '23505';
const MAX_CAUSE_DEPTH = 5;

interface PgErrorLike {
  readonly code?: string;
  readonly constraint?: string;
}

export function uniqueViolationConstraint(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    const candidate = current as PgErrorLike;

    if (typeof candidate.code === 'string') {
      return candidate.code === UNIQUE_VIOLATION ? (candidate.constraint ?? 'unknown') : undefined;
    }

    current = current.cause;
  }

  return undefined;
}
