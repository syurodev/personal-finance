import { runMigrations } from './migrate.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
await runMigrations(url);
console.log('Migrations applied');
