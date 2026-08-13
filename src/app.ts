import cors from 'cors';
import express, { json, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { config } from './config/env.config.js';
import { logger } from './shared/logger/logger.js';
import { errorHandler } from './shared/middlewares/error-handler.middleware.js';
import { notFound } from './shared/middlewares/not-found.middleware.js';
import { requestContext } from './shared/middlewares/request-context.middleware.js';
import { createApiRouter } from './routes/api.routes.js';

const JSON_BODY_LIMIT = '100kb';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  app.set('trust proxy', 1);

  app.use(helmet());

  app.use(
    cors({
      origin: config.corsOrigins ? [...config.corsOrigins] : '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: false,
      maxAge: 600,
    }),
  );

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).ctx.requestId,
      customLogLevel: (_req, res, err) => {
        if (err ?? res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(json({ limit: JSON_BODY_LIMIT }));

  app.use('/', createApiRouter());

  app.use(notFound);

  app.use(errorHandler);

  return app;
}
