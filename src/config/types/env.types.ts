import type { Brand } from '../../shared/types/api.types.js';
import type { ENVS } from '../constants/env-keys.constant.js';
import type { LOG_LEVELS } from '../constants/log-levels.constant.js';
import type { NODE_ENVS } from '../constants/node-envs.constant.js';

export type EnvKey = (typeof ENVS)[keyof typeof ENVS];

export type NodeEnv = (typeof NODE_ENVS)[number];

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface SlasCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface BrandSfccConfig {
  readonly shortCode: string;
  readonly orgId: string;
  readonly siteId: string;
  readonly redirectUri: string;
}

export interface Config {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;

  readonly corsOrigins: readonly string[] | undefined;

  readonly slas: Readonly<Record<Brand, SlasCredentials>>;
  readonly sfcc: Readonly<Record<Brand, BrandSfccConfig>>;
}
