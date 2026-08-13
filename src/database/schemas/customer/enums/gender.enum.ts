export const GENDERS = ['M', 'F', 'OTHER', 'UNKNOWN'] as const;

export type Gender = (typeof GENDERS)[number];
