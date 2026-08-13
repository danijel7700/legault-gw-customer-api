import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { logger } from '../shared/logger/logger.js';

import { dbConfig } from './config.js';
import * as schema from './schemas/index.js';

const pool = new Pool({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database,
  ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
  max: dbConfig.poolMax,
  idleTimeoutMillis: dbConfig.idleTimeoutMs,
  connectionTimeoutMillis: dbConfig.connectTimeoutMs,
});

pool.on('error', (error: Error): void => {
  logger.error({ err: error }, 'Idle PostgreSQL client errored — the pool will replace it');
});

export const db: NodePgDatabase<typeof schema> = drizzle({ client: pool, schema });

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query('SELECT 1');
}

let closed = false;

export async function closeDatabase(): Promise<void> {
  if (closed) {
    return;
  }
  closed = true;

  await pool.end();
  logger.info('PostgreSQL pool closed');
}
