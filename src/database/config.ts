import { z } from 'zod';

import { ENVS } from '../config/constants/env-keys.constant.js';
import '../config/load-env.js';

export interface DbConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly database: string;
  readonly ssl: boolean;
  readonly poolMax: number;
  readonly idleTimeoutMs: number;
  readonly connectTimeoutMs: number;
}

const DEFAULT_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

const required = z.string().min(1);
const positiveInt = z.coerce.number().int().positive();

const isProduction = process.env[ENVS.NODE_ENV] === 'production';

const dbEnvSchema = z.object({
  [ENVS.DB_HOST]: required,
  [ENVS.DB_PORT]: z.coerce.number().int().min(1).max(65_535),
  [ENVS.DB_USERNAME]: required,
  [ENVS.DB_PASSWORD]: required,
  [ENVS.DB_NAME]: required,
  [ENVS.DB_SSL]: z.stringbool().default(isProduction),
  [ENVS.DB_POOL_MAX]: positiveInt.default(DEFAULT_POOL_MAX),
  [ENVS.DB_IDLE_TIMEOUT_MS]: positiveInt.default(DEFAULT_IDLE_TIMEOUT_MS),
  [ENVS.DB_CONNECT_TIMEOUT_MS]: positiveInt.default(DEFAULT_CONNECT_TIMEOUT_MS),
});

function loadDbConfig(): DbConfig {
  const result = dbEnvSchema.safeParse(process.env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid database configuration:\n${problems}`);
  }

  const env = result.data;

  return Object.freeze({
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: env.DB_SSL,
    poolMax: env.DB_POOL_MAX,
    idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
    connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
  });
}

export const dbConfig: DbConfig = loadDbConfig();

export const buildConnectionString = (c: DbConfig): string =>
  `postgresql://${encodeURIComponent(c.username)}:${encodeURIComponent(c.password)}` +
  `@${c.host}:${c.port}/${c.database}`;
