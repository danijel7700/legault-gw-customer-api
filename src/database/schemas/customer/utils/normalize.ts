export const PLACEHOLDER_EMAIL_PATTERN = /-noname@rewards\.com$/i;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const email = raw.trim().toLowerCase();

  if (email.length === 0 || PLACEHOLDER_EMAIL_PATTERN.test(email)) {
    return null;
  }

  return email;
}

export function normalizePostalCode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const postalCode = raw.replace(/\s+/g, '').toUpperCase();

  return postalCode.length === 0 ? null : postalCode;
}
