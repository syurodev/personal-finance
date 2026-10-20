import { parseEnv } from './env.js';

const base = {
  BASE_URL: 'https://finance.example.com/',
  DATABASE_URL: 'postgres://pf_app:pf_app@localhost:5433/personal_finance',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults and trims trailing slash from BASE_URL', () => {
    const env = parseEnv(base);
    expect(env.BASE_URL).toBe('https://finance.example.com');
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.allowedEmails.size).toBe(0);
  });

  it('normalises ALLOWED_EMAILS into a lowercase set', () => {
    const env = parseEnv({ ...base, ALLOWED_EMAILS: ' A@Example.com, b@example.com ,,' });
    expect([...env.allowedEmails]).toEqual(['a@example.com', 'b@example.com']);
  });

  it('rejects a short BETTER_AUTH_SECRET', () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow();
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => parseEnv(rest)).toThrow();
  });
});
