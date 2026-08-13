export const SOURCE_SYSTEMS = ['SFCC', 'MOBILE_APP', 'CORE_API'] as const;

export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];
