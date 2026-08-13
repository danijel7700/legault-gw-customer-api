import type { Config } from './types/env.types.js';
import { envSchema } from './validations/env.validation.js';

let cached: Config | undefined;

function parseCorsOrigins(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? Object.freeze(origins) : undefined;
}

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const env = result.data;

  cached = Object.freeze({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    slas: Object.freeze({
      rens: Object.freeze({
        clientId: env.RENS_SLAS_CLIENT_ID,
        clientSecret: env.RENS_SLAS_CLIENT_SECRET,
      }),
      mondou: Object.freeze({
        clientId: env.MONDOU_SLAS_CLIENT_ID,
        clientSecret: env.MONDOU_SLAS_CLIENT_SECRET,
      }),
    }),
    sfcc: Object.freeze({
      rens: Object.freeze({
        shortCode: env.RENS_SHORT_CODE,
        orgId: env.RENS_ORG_ID,
        siteId: env.RENS_SITE_ID,
        redirectUri: env.RENS_REDIRECT_URI,
      }),
      mondou: Object.freeze({
        shortCode: env.MONDOU_SHORT_CODE,
        orgId: env.MONDOU_ORG_ID,
        siteId: env.MONDOU_SITE_ID,
        redirectUri: env.MONDOU_REDIRECT_URI,
      }),
    }),
  });

  return cached;
}

export function getConfig(): Config {
  if (!cached) {
    throw new Error(
      'Configuration accessed before loadConfig() ran. ' +
        'Config is only available after the boot sequence in server.ts.',
    );
  }
  return cached;
}

export const config: Config = new Proxy({} as Config, {
  get: (_target, property) => Reflect.get(getConfig(), property) as unknown,
  has: (_target, property) => Reflect.has(getConfig(), property),
  ownKeys: () => Reflect.ownKeys(getConfig()),
  getOwnPropertyDescriptor: (_target, property): PropertyDescriptor | undefined => {
    const descriptor = Reflect.getOwnPropertyDescriptor(getConfig(), property);

    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
  set: (): never => {
    throw new Error('config is read-only');
  },
  deleteProperty: (): never => {
    throw new Error('config is read-only');
  },
});
