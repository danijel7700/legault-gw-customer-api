import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import '../config/load-env.js';
import * as schema from '../database/schemas/index.js';

const TEST_DATABASE_NAME = process.env.TEST_DB_NAME ?? 'core_customer_api_test';
const MIGRATIONS_FOLDER = 'src/database/migrations';

interface ConnectionSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
}

export interface TestDatabase {
  readonly db: NodePgDatabase<typeof schema>;
  readonly pool: Pool;
  close(): Promise<void>;
}

function required(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set to run the integration tests`);
  }

  return value;
}

function connectionSettings(): ConnectionSettings {
  return {
    host: required('DB_HOST'),
    port: Number(required('DB_PORT')),
    user: required('DB_USERNAME'),
    password: required('DB_PASSWORD'),
  };
}

async function ensureDatabaseExists(settings: ConnectionSettings): Promise<void> {
  const admin = new Pool({ ...settings, database: 'postgres', max: 1 });

  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DATABASE_NAME,
    ]);

    if (existing.rowCount === 0) {
      // Identifier, so it cannot be parameterised; the name is not user input.
      await admin.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    }
  } finally {
    await admin.end();
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const settings = connectionSettings();

  await ensureDatabaseExists(settings);

  const pool = new Pool({ ...settings, database: TEST_DATABASE_NAME, max: 4 });
  const db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    pool,
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE customer CASCADE');
}
