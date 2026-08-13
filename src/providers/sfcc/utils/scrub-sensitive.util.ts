import {
  BODY_LOG_LIMIT,
  MAX_SCRUB_DEPTH,
  REDACTED,
  SENSITIVE_KEY,
} from '../constants/sfcc-http.constant.js';

export function summariseBody(data: unknown): string | undefined {
  if (data === undefined || data === null) {
    return undefined;
  }

  const text = typeof data === 'string' ? data : safeStringify(scrubSensitive(data));

  return text.length > BODY_LOG_LIMIT ? `${text.slice(0, BODY_LOG_LIMIT)}…` : text;
}

export function scrubSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => scrubSensitive(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]: [string, unknown]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : scrubSensitive(item, depth + 1),
    ]),
  );
}

function safeStringify(data: unknown): string {
  try {
    const json: unknown = JSON.stringify(data);

    return typeof json === 'string' ? json : '[unserialisable upstream body]';
  } catch {
    return '[unserialisable upstream body]';
  }
}
