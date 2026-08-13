import type { Server } from 'node:http';

import { createApp } from './app.js';
import { ENVS } from './config/constants/env-keys.constant.js';
import { loadConfig } from './config/env.config.js';
import { getAppSsmPrefix, resolveAppSsmSecrets } from './config/ssm-bootstrap.js';
import { closeDatabase } from './database/index.js';
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
        // Abnormal path: the HTTP server would not close. The pool is left to
        // the OS along with the sockets rather than adding a second exit route.
        logger.error({ err: error }, 'Error while closing the HTTP server');
        process.exit(1);
      }
      logger.info('HTTP server closed cleanly');

      // Deliberately not awaited here: an async close callback trips
      // no-misused-promises, and the forceExit timer above still fires because
      // the pool's open sockets keep the event loop alive.
      void closeDependencies();
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

/**
 * Runs after the HTTP server has stopped accepting connections, so in-flight
 * queries have already finished. A failure to drain is logged, not fatal — the
 * process is exiting either way.
 */
async function closeDependencies(): Promise<void> {
  try {
    await closeDatabase();
  } catch (error) {
    logger.error({ err: error }, 'Failed to close the PostgreSQL pool');
  }

  process.exit(0);
}

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start');
  process.exit(1);
});
