export const LANGUAGES = ['en', 'fr'] as const;

export type Language = (typeof LANGUAGES)[number];
