import { config as loadDotenv } from 'dotenv';

export function loadEnvFile(): void {
  loadDotenv({ quiet: true, override: false });
}

loadEnvFile();
