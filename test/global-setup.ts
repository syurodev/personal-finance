import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { loadTestEnv } from './setup-env.js';

export default async function globalSetup(): Promise<void> {
  loadTestEnv();
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL missing in .env.test');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
    );
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
