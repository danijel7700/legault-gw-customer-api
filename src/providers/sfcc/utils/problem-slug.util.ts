export function problemSlug(body: string | undefined): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(body);

    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
      return undefined;
    }

    const { type } = parsed;

    return typeof type === 'string' ? type.split('/').pop() : undefined;
  } catch {
    return undefined;
  }
}
