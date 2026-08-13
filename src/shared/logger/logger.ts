import { pino, type Logger, type LoggerOptions } from 'pino';

import { LOG_LEVELS } from '../../config/constants/log-levels.constant.js';
import { ENVS } from '../../config/constants/env-keys.constant.js';
import '../../config/load-env.js';

import { REDACT_PATHS } from './constants/redact-paths.constant.js';

const rawLevel = process.env[ENVS.LOG_LEVEL];

const level =
  rawLevel !== undefined && (LOG_LEVELS as readonly string[]).includes(rawLevel)
    ? rawLevel
    : 'info';

const isProduction = process.env[ENVS.NODE_ENV] === 'production';

const baseOptions: LoggerOptions = {
  level,
  base: { service: 'customer-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [...REDACT_PATHS],
    remove: true,
  },
};

export const logger: Logger = isProduction
  ? pino(baseOptions)
  : pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service',
        },
      },
    });
