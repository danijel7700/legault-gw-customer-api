export const EXTERNAL_SYSTEMS = ['SFCC', 'NAV', 'SFSC', 'SFMC'] as const;

export type ExternalSystem = (typeof EXTERNAL_SYSTEMS)[number];
