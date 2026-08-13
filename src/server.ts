import type { Server } from 'node:http';

import { createApp } from './app.js';
import { ENVS } from './config/constants/env-keys.constant.js';
import { loadConfig } from './config/env.config.js';
import { getAppSsmPrefix, resolveAppSsmSecrets } from './config/ssm-bootstrap.js';
import { logger } from './shared/logger/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const HEADERS_TIMEOUT_MS = 66_000;

async function bootstrap(): Promise<void> {
  const ssmPrefix = getAppSsmPrefix();

  await resolveAppSsmSecrets(ssmPrefix, [
    ENVS.RENS_SHORT_CODE,
    ENVS.RENS_ORG_ID,
    ENVS.RENS_SITE_ID,
    ENVS.MONDOU_SHORT_CODE,
    ENVS.MONDOU_ORG_ID,
    ENVS.MONDOU_SITE_ID,
  ]);

  await resolveAppSsmSecrets(
    ssmPrefix,
    [
      ENVS.RENS_SLAS_CLIENT_ID,
      ENVS.RENS_SLAS_CLIENT_SECRET,
      ENVS.MONDOU_SLAS_CLIENT_ID,
      ENVS.MONDOU_SLAS_CLIENT_SECRET,
    ],
    { withDecryption: true },
  );

  const config = loadConfig();

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, nodeEnv: config.nodeEnv, logLevel: config.logLevel },
      `Customer API listening on port ${String(config.port)}`,
    );
  });
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;

  registerShutdownHandlers(server);
}

function registerShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, 'Shutdown signal received — draining connections');

    const forceExit = setTimeout(() => {
      logger.fatal(
        { timeoutMs: SHUTDOWN_TIMEOUT_MS },
        'Graceful shutdown timed out — forcing exit',
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close((error) => {
      if (error) {
        logger.error({ err: error }, 'Error while closing the HTTP server');
        process.exit(1);
      }
      logger.info('HTTP server closed cleanly');
      process.exit(0);
    });

    server.closeIdleConnections();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
}

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start');
  process.exit(1);
});
