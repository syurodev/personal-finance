import type { NestExpressApplication } from '@nestjs/platform-express';
import { startApp } from './app.js';

describe('health', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz returns ok', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('better-auth is mounted under /api/auth', async () => {
    const res = await fetch(`${baseUrl}/api/auth/ok`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('parses JSON bodies for Nest routes', async () => {
    const res = await fetch(`${baseUrl}/healthz/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ping: 1 }),
    });
    expect(await res.json()).toEqual({ ping: 1 });
  });
});
