import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  ALLOWED_EMAILS: z.string().default(''),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'ALLOWED_EMAILS'> & {
  allowedEmails: ReadonlySet<string>;
};

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const { ALLOWED_EMAILS, ...parsed } = EnvSchema.parse(raw);
  return {
    ...parsed,
    BASE_URL: parsed.BASE_URL.replace(/\/+$/, ''),
    allowedEmails: new Set(
      ALLOWED_EMAILS.split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
