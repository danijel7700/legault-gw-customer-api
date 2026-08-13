import { defineConfig } from 'drizzle-kit';

import { buildConnectionString, dbConfig } from './src/database/config.js';

const url = dbConfig.ssl
  ? `${buildConnectionString(dbConfig)}?sslmode=no-verify`
  : buildConnectionString(dbConfig);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schemas/index.ts',
  out: './src/database/migrations',
  dbCredentials: { url },
});
